// checkRateLimitBucket.js (Option B: PK/TTL)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * checkRateLimitBucket
 * @param {Object} p
 * @param {string} p.scope - "IP" | "USER" | "ROUTE" | ...
 * @param {string} p.key - identifiant (ip, userId, etc.)
 * @param {number} p.capacity - nb max de tokens dans le seau
 * @param {number} p.refillRate - tokens par seconde
 * @param {number} [p.cost=1] - coût de l'opération
 * @param {string} [p.table=process.env.RATE_LIMIT_TABLE]
 * @param {number} [p.ttlSeconds=86400] - TTL anti-gaspillage (en secondes)
 * @returns {Promise<{allowed:boolean, remaining:number, reset:number, headers:Object, status?:number}>}
 */
export async function checkRateLimitBucket({
    scope,
    key,
    capacity,
    refillRate,
    cost = 1,
    table = process.env.RATE_LIMIT_TABLE,
    ttlSeconds = 86400,
    windowSeconds
}) {
    const pkValue = `RL#${scope}#${key}`;
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);

    const log = (...args) => { console.log("[RL]", ...args); };
    const warn = (...args) => { console.warn("[RL]", ...args); };

    // 1) GET
    let item;

    try {
        const res = await ddb.send(new GetCommand({
            TableName: table,
            Key: { PK: pkValue },
            ConsistentRead: true
        }));
        item = res.Item;
    } catch (e) {
        warn("Get failed", e);
    }

    if (windowSeconds) {

        const capacityInt = Number.isFinite(capacity) ? capacity : 3;
        const costInt = Number.isFinite(cost) ? cost : 1;

        if (!item) {
            const remaining = Math.max(0, capacityInt - costInt);
            const resetSec = nowSec + windowSeconds; // fin de la fenêtre

            try {
                await ddb.send(new UpdateCommand({
                    TableName: table,
                    Key: { PK: pkValue },
                    UpdateExpression: "SET #tokens = :tokens, #win = :win, #ver = :ver, #ttl = :ttl",
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
                }));
            } catch (err) {
                warn("Create race (window mode), retrying", err?.name);
                return await checkRateLimitBucket({
                    scope,
                    key,
                    capacity,
                    refillRate,
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

        const prevTokens = typeof item.tokens === "number" ? item.tokens : capacityInt;
        const windowStartedAt = typeof item.windowStartedAt === "number" ? item.windowStartedAt : nowSec;
        const elapsed = nowSec - windowStartedAt;
        const resetSec = windowStartedAt + windowSeconds;
        const prevVer = item.ver ?? 0;
        const newVer = prevVer + 1;

        if (elapsed >= windowSeconds) {
            const remaining = Math.max(0, capacityInt - costInt);

            try {
                await ddb.send(new UpdateCommand({
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
                    },
                    ConditionExpression: "attribute_not_exists(#ver) OR #ver = :prevVer",
                }));
            } catch (err) {
                if (err.name === "ConditionalCheckFailedException") {
                    // quelqu'un a modifié entre temps → on retente une fois
                    log("CAS conflict (window reset), retry once");
                    return await checkRateLimitBucket({
                        scope,
                        key,
                        capacity,
                        refillRate,
                        cost,
                        table,
                        ttlSeconds,
                        windowSeconds,
                    });
                }
                warn("Update failed (window reset)", err);
                return {
                    allowed: true,
                    remaining: prevTokens,
                    reset: nowSec,
                    headers: {},
                };
            }

            const headers = {
                "X-RateLimit-Limit": String(capacityInt),
                "X-RateLimit-Remaining": String(remaining),
                "X-RateLimit-Reset": String(nowSec + windowSeconds),
            };

            if (remaining <= 0) {
                headers["Retry-After"] = String(windowSeconds);
                return {
                    allowed: false,
                    remaining: 0,
                    reset: nowSec + windowSeconds,
                    headers,
                    status: 429,
                };
            }

            return {
                allowed: true,
                remaining,
                reset: nowSec + windowSeconds,
                headers,
            };
        }

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

        const newTokens = prevTokens - costInt;

        try {
            await ddb.send(new UpdateCommand({
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
                },
                ConditionExpression: "attribute_not_exists(#ver) OR #ver = :prevVer",
            }));
        } catch (err) {
            if (err.name === "ConditionalCheckFailedException") {
                log("CAS conflict (window consume), retry once");
                return await checkRateLimitBucket({
                    scope,
                    key,
                    capacity,
                    refillRate,
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

    if (!item) {
        // Première fois : on remplit au max puis on consomme 'cost'
        const remaining = Math.max(0, capacity - cost);

        let resetSec;
        if (remaining > 0) {
            resetSec = nowSec;
        } else {
            resetSec = nowSec + Math.ceil(cost / refillRate);
        }

        try {
            await ddb.send(new UpdateCommand({
                TableName: table,
                Key: { PK: pkValue },
                UpdateExpression: "SET #tokens = :tokens, #last = :last, #cap = :cap, #rate = :rate, #ver = :ver, #ttl = :ttl",
                ExpressionAttributeNames: {
                    "#tokens": "tokens",
                    "#last": "lastRefill",
                    "#cap": "capacity",
                    "#rate": "refillRate",
                    "#ver": "ver",
                    "#ttl": "TTL"            // ← attribut TTL en base
                },
                ExpressionAttributeValues: {
                    ":tokens": remaining,
                    ":last": nowMs,
                    ":cap": capacity,
                    ":rate": refillRate,
                    ":ver": 1,
                    ":ttl": nowSec + ttlSeconds
                },
                ConditionExpression: "attribute_not_exists(#ver)" // crée uniquement si absent
            }));
        } catch (e) {
            // Conflit de création → on retente via la voie normale (rare)
            warn("Create race, retrying with read-modify-write", e?.name);
            return await checkRateLimitBucket({ scope, key, capacity, refillRate, cost, table, ttlSeconds });
        }

        const headers = {
            "X-RateLimit-Limit": String(capacity),
            "X-RateLimit-Remaining": String(remaining),
            "X-RateLimit-Reset": String(resetSec)
        };

        if (remaining <= 0) {
            const retryAfter = Math.ceil(cost / refillRate);
            headers["Retry-After"] = String(retryAfter);
            return { allowed: false, remaining: 0, reset: resetSec, headers, status: 429 };
        }
        return { allowed: true, remaining, reset: resetSec, headers };
    }

    // 2) Calcul local du refill
    const prevTokens = typeof item.tokens === "number" ? item.tokens : capacity;
    const prevLast = typeof item.lastRefill === "number" ? item.lastRefill : nowMs;
    const deltaSec = Math.max(0, (nowMs - prevLast) / 1000);
    const refill = Math.floor(deltaSec * refillRate);
    const afterRefill = Math.min(capacity, prevTokens + refill);
    const canPay = afterRefill >= cost;
    const newTokens = canPay ? (afterRefill - cost) : afterRefill; // ← soustraction corrigée
    const newLast = refill > 0 ? nowMs : prevLast;
    const newVer = (item.ver ?? 0) + 1;

    const need = Math.max(0, cost - afterRefill);
    const retryAfter = need > 0 ? Math.ceil(need / refillRate) : 0;
    const resetSec = retryAfter > 0 ? nowSec + retryAfter : nowSec;

    // 3) UPDATE (CAS via ver)
    const tryUpdate = async () => {
        await ddb.send(new UpdateCommand({
            TableName: table,
            Key: { PK: pkValue },
            UpdateExpression: "SET #tokens = :tokens, #last = :last, #ver = :ver, #ttl = :ttl",
            ConditionExpression: "attribute_not_exists(#ver) OR #ver = :prevVer",
            ExpressionAttributeNames: {
                "#tokens": "tokens",
                "#last": "lastRefill",
                "#ver": "ver",
                "#ttl": "TTL"            // ← attribut TTL en base
            },
            ExpressionAttributeValues: {
                ":tokens": newTokens,
                ":last": newLast,
                ":ver": newVer,
                ":prevVer": item.ver ?? 0,
                ":ttl": nowSec + ttlSeconds
            }
        }));
    };

    try {
        await tryUpdate();
    } catch (e) {
        if (e.name === "ConditionalCheckFailedException") {
            log("CAS conflict, retry once");
            const retry = await checkRateLimitBucket({ scope, key, capacity, refillRate, cost, table, ttlSeconds });
            return retry;
        }
        warn("Update failed", e);
        // En cas d’erreur infra, on préfère laisser passer (optionnel)
        return { allowed: true, remaining: prevTokens, reset: nowSec, headers: {} };
    }

    const headers = {
        "X-RateLimit-Limit": String(capacity),
        "X-RateLimit-Remaining": String(newTokens),
        "X-RateLimit-Reset": String(resetSec)
    };

    if (!canPay) {
        if (retryAfter > 0) headers["Retry-After"] = String(retryAfter);
        return { allowed: false, remaining: newTokens, reset: resetSec, headers, status: 429 };
    }

    return { allowed: true, remaining: newTokens, reset: resetSec, headers };
}
