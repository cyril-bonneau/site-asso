// backend/rateLimit/checkRateLimitBucket.js
// Version découpée qui gère:
// - le mode token-bucket (refill continu) via rateLimitCore + rateLimitStorageDdb
// - le mode fenêtre fixe via windowSeconds (logique dédiée avec CAS)

import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { computeBucketState } from "./rateLimitCore.js";
import {
    getDefaultDdb,
    buildRateLimitKey,
    loadBucket,
    saveBucket,
} from "./rateLimitStorageDdb.js";

function makeLogger(scope) {
    const prefix = `[rate-limit:${scope}]`;
    return {
        debug: (...args) => {
            if (process.env.ENABLE_RL_LOGS === "true") {
                console.log(prefix, ...args);
            }
        },
        warn: (...args) => console.warn(prefix, ...args),
    };
}

/**
 * Fabrique une fonction checkRateLimitBucket avec un client DDB injecté.
 *
 * @param {Object} [deps]
 * @param {import("@aws-sdk/lib-dynamodb").DynamoDBDocumentClient} [deps.ddb]
 */
export function createCheckRateLimitBucket({ ddb = getDefaultDdb() } = {}) {
    /**
     * @param {Object} p
     * @param {string} p.scope
     * @param {string} p.key
     * @param {number} p.capacity
     * @param {number} p.refillRate
     * @param {number} [p.cost=1]
     * @param {string} [p.table=process.env.RATE_LIMIT_TABLE]
     * @param {number} [p.ttlSeconds=86400]
     * @param {number} [p.nowMs=Date.now()]
     * @param {number} [p.windowSeconds] - si défini => mode fenêtre
     */
    const fn = async function checkRateLimitBucket({
        scope = "IP",
        key,
        capacity,
        refillRate,
        cost = 1,
        table = process.env.RATE_LIMIT_TABLE,
        ttlSeconds = 86400,
        nowMs = Date.now(),
        windowSeconds,
    }) {
        const { debug, warn } = makeLogger(scope);

        if (!table) {
            throw new Error("RATE_LIMIT_TABLE non défini");
        }
        if (!key) {
            throw new Error("rate limit key manquant");
        }

        const nowSec = Math.floor(nowMs / 1000);
        const pk = buildRateLimitKey(scope, key);

        // ───────────── Mode FENÊTRE fixe (windowSeconds) ─────────────
        if (windowSeconds) {
            return await handleWindowMode({
                ddb,
                scope,
                table,
                pk,
                capacity,
                cost,
                ttlSeconds,
                windowSeconds,
                nowSec,
                debug,
                warn,
                retryFn: fn, // pour la récursion en cas de CAS
            });
        }

        // ───────────── Mode TOKEN BUCKET (refill continu) ─────────────
        let item = null;
        try {
            item = await loadBucket({ ddb, tableName: table, pk });
            debug("Item actuel (token-bucket)", item);
        } catch (e) {
            warn("Erreur Get rate-limit (token-bucket)", e);
        }

        // Logique pure (pas d’AWS ici)
        const {
            allowed,
            newTokens,
            resetSec,
            retryAfter,
            capacity: capInt,
        } = computeBucketState({
            capacity,
            refillRate,
            cost,
            nowSec,
            item,
        });

        try {
            await saveBucket({
                ddb,
                tableName: table,
                pk,
                tokens: newTokens,
                nowSec,
                ttlSeconds,
            });
            debug("Bucket sauvegardé (token-bucket)", {
                tokens: newTokens,
                resetSec,
            });
        } catch (e) {
            // Fail-open: on log, mais on ne bloque pas la requête
            warn("Erreur Update rate-limit (token-bucket)", e);
        }

        const headers = {
            "X-RateLimit-Limit": String(capInt),
            "X-RateLimit-Remaining": String(
                Math.max(0, Math.floor(newTokens)),
            ),
            "X-RateLimit-Reset": String(resetSec),
        };

        if (!allowed && retryAfter > 0) {
            headers["Retry-After"] = String(retryAfter);
        }

        if (!allowed) {
            return {
                allowed: false,
                remaining: newTokens,
                reset: resetSec,
                headers,
                status: 429,
            };
        }

        return {
            allowed: true,
            remaining: newTokens,
            reset: resetSec,
            headers,
        };
    };

    return fn;
}

// Instance par défaut : utilisée par withRateLimit et les Lambdas
export const checkRateLimitBucket = createCheckRateLimitBucket();

/**
 * Mode fenêtre fixe (windowSeconds).
 *
 * C’est la logique que tu avais dans ta version monolithique:
 * - Item inexistant → création avec tokens = capacity - cost
 * - Fenêtre expirée → reset window, CAS sur ver
 * - Fenêtre courante → consume ou refus + Retry-After
 * - CAS conflict → on retente une fois via retryFn(...)
 */
async function handleWindowMode({
    ddb,
    scope,
    table,
    pk,
    capacity,
    cost,
    ttlSeconds,
    windowSeconds,
    nowSec,
    debug,
    warn,
    retryFn,
}) {
    const pkValue = pk;

    // 1) GET (ConsistentRead)
    let item;
    try {
        const res = await ddb.send(
            new GetCommand({
                TableName: table,
                Key: { PK: pkValue },
                ConsistentRead: true,
            }),
        );
        item = res.Item;
        debug("Item actuel (window mode)", item);
    } catch (e) {
        warn("Get failed (window mode)", e);
    }

    const capacityInt = Number.isFinite(capacity) ? capacity : 3;
    const costInt = Number.isFinite(cost) ? cost : 1;

    // ─── Cas 1: aucune entrée -> création de la fenêtre ───
    if (!item) {
        const remaining = Math.max(0, capacityInt - costInt);
        const resetSec = nowSec + windowSeconds; // fin de la fenêtre

        try {
            await ddb.send(
                new UpdateCommand({
                    TableName: table,
                    Key: { PK: pkValue },
                    UpdateExpression:
                        "SET #tokens = :tokens, #win = :win, #ver = :ver, #ttl = :ttl",
                    ExpressionAttributeNames: {
                        "#tokens": "tokens",
                        "#win": "windowStartedAt",
                        "#ver": "ver",
                        "#ttl": "TTL",
                    },
                    ExpressionAttributeValues: {
                        ":tokens": remaining,
                        ":win": nowSec,
                        ":ver": 1,
                        ":ttl": nowSec + ttlSeconds,
                    },
                    ConditionExpression: "attribute_not_exists(#ver)", // création only
                }),
            );
        } catch (err) {
            warn(
                "Create race (window mode), retrying",
                err?.name || err?.code,
            );
            // On relance le check complet une seule fois
            return await retryFn({
                scope,
                key: pkValue.split("#").slice(2).join("#"), // IP ou email
                capacity,
                refillRate: 0, // ignoré en mode fenêtre
                cost,
                table,
                ttlSeconds,
                windowSeconds,
            });
        }

        const headers = {
            "X-RateLimit-Limit": String(capacityInt),
            "X-RateLimit-Remaining": String(remaining),
            "X-RateLimit-Reset": String(resetSec),
        };

        if (remaining <= 0) {
            headers["Retry-After"] = String(windowSeconds);
            return {
                allowed: false,
                remaining: 0,
                reset: resetSec,
                headers,
                status: 429,
            };
        }

        return { allowed: true, remaining, reset: resetSec, headers };
    }

    // ─── Cas 2: fenêtre existante ───
    const prevTokens =
        typeof item.tokens === "number" ? item.tokens : capacityInt;
    const windowStartedAt =
        typeof item.windowStartedAt === "number"
            ? item.windowStartedAt
            : nowSec;
    const elapsed = nowSec - windowStartedAt;
    const resetSec = windowStartedAt + windowSeconds;
    const prevVer = item.ver ?? 0;
    const newVer = prevVer + 1;

    // 2a) Fenêtre expirée → reset
    if (elapsed >= windowSeconds) {
        const remaining = Math.max(0, capacityInt - costInt);

        try {
            await ddb.send(
                new UpdateCommand({
                    TableName: table,
                    Key: { PK: pkValue },
                    UpdateExpression:
                        "SET #tokens = :tokens, #win = :win, #ver = :ver, #ttl = :ttl",
                    ExpressionAttributeNames: {
                        "#tokens": "tokens",
                        "#win": "windowStartedAt",
                        "#ver": "ver",
                        "#ttl": "TTL",
                    },
                    ExpressionAttributeValues: {
                        ":tokens": remaining,
                        ":win": nowSec,
                        ":ver": newVer,
                        ":ttl": nowSec + ttlSeconds,
                        ":prevVer": prevVer
                    },
                    ConditionExpression:
                        "attribute_not_exists(#ver) OR #ver = :prevVer",
                }),
            );
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                // quelqu'un a modifié entre temps → on retente une fois
                debug("CAS conflict (window reset), retry once");
                return await retryFn({
                    scope,
                    key: pkValue.split("#").slice(2).join("#"),
                    capacity,
                    refillRate: 0,
                    cost,
                    table,
                    ttlSeconds,
                    windowSeconds,
                });
            }
            warn("Update failed (window reset)", err);
            // Fail-open pour ne pas bloquer en cas d’erreur infra
            return {
                allowed: true,
                remaining: prevTokens,
                reset: nowSec,
                headers: {},
            };
        }

        const newReset = nowSec + windowSeconds;
        const headers = {
            "X-RateLimit-Limit": String(capacityInt),
            "X-RateLimit-Remaining": String(remaining),
            "X-RateLimit-Reset": String(newReset),
        };

        if (remaining <= 0) {
            headers["Retry-After"] = String(windowSeconds);
            return {
                allowed: false,
                remaining: 0,
                reset: newReset,
                headers,
                status: 429,
            };
        }

        return {
            allowed: true,
            remaining,
            reset: newReset,
            headers,
        };
    }

    // 2b) Fenêtre en cours : plus de tokens → refus
    if (prevTokens < costInt) {
        const retryAfter = Math.max(1, resetSec - nowSec);

        const headers = {
            "X-RateLimit-Limit": String(capacityInt),
            "X-RateLimit-Remaining": String(prevTokens),
            "X-RateLimit-Reset": String(resetSec),
            "Retry-After": String(retryAfter),
        };

        return {
            allowed: false,
            remaining: prevTokens,
            reset: resetSec,
            headers,
            status: 429,
        };
    }

    // 2c) Fenêtre en cours : on consomme les tokens
    const newTokens = prevTokens - costInt;

    try {
        await ddb.send(
            new UpdateCommand({
                TableName: table,
                Key: { PK: pkValue },
                UpdateExpression:
                    "SET #tokens = :tokens, #win = :win, #ver = :ver, #ttl = :ttl",
                ExpressionAttributeNames: {
                    "#tokens": "tokens",
                    "#win": "windowStartedAt",
                    "#ver": "ver",
                    "#ttl": "TTL",
                },
                ExpressionAttributeValues: {
                    ":tokens": newTokens,
                    ":win": windowStartedAt,
                    ":ver": newVer,
                    ":ttl": nowSec + ttlSeconds,
                    ":prevVer": prevVer
                },
                ConditionExpression:
                    "attribute_not_exists(#ver) OR #ver = :prevVer",
            }),
        );
    } catch (err) {
        if (err.name === "ConditionalCheckFailedException") {
            debug("CAS conflict (window consume), retry once");
            return await retryFn({
                scope,
                key: pkValue.split("#").slice(2).join("#"),
                capacity,
                refillRate: 0,
                cost,
                table,
                ttlSeconds,
                windowSeconds,
            });
        }
        warn("Update failed (window consume)", err);
        return {
            allowed: true,
            remaining: prevTokens,
            reset: resetSec,
            headers: {},
        };
    }

    const headers = {
        "X-RateLimit-Limit": String(capacityInt),
        "X-RateLimit-Remaining": String(newTokens),
        "X-RateLimit-Reset": String(resetSec),
    };

    return {
        allowed: true,
        remaining: newTokens,
        reset: resetSec,
        headers,
    };
}
