// backend/rateLimit/checkRateLimitBucket.test.js

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createCheckRateLimitBucket } from "./checkRateLimitBucket.js";

describe("createCheckRateLimitBucket / checkRateLimitBucket", () => {
    const TABLE = "RateLimitTableTest";

    let sendMock;
    let fakeDdb;
    let check;

    beforeEach(() => {
        sendMock = vi.fn();
        fakeDdb = { send: sendMock };
        check = createCheckRateLimitBucket({ ddb: fakeDdb });
    });

    // ───────────────── TOKEN BUCKET MODE ─────────────────

    it("token bucket: charge, calcule et sauvegarde le seau puis autorise quand assez de tokens", async () => {
        // 1er appel: GetCommand (loadBucket)
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            expect(cmd.input.TableName).toBe(TABLE);
            expect(cmd.input.Key.PK).toBe("RL#LOGIN#user@example.com");
            return { Item: { tokens: 10, windowStartedAt: 1000 } };
        });

        // 2e appel: UpdateCommand (saveBucket)
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(UpdateCommand);
            expect(cmd.input.TableName).toBe(TABLE);
            expect(cmd.input.Key.PK).toBe("RL#LOGIN#user@example.com");
            return {};
        });

        const res = await check({
            scope: "LOGIN",
            key: "user@example.com",
            capacity: 10,
            refillRate: 0, // pas de refill, simple décrément
            cost: 1,
            table: TABLE,
            ttlSeconds: 60,
            nowMs: 2000 * 1000 // nowSec = 2000
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBeCloseTo(9);
        expect(res.headers["X-RateLimit-Limit"]).toBe("10");
        expect(res.headers["X-RateLimit-Remaining"]).toBe(String(Math.floor(res.remaining)));
        expect(res.headers["X-RateLimit-Reset"]).toBeDefined();

        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it("token bucket: renvoie un refus 429 avec Retry-After quand pas assez de tokens", async () => {
        // Item très bas en tokens pour forcer le refus
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            return { Item: { tokens: 0, windowStartedAt: 1000 } };
        });

        // saveBucket sera tout de même appelé (fail-open si update échoue)
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(UpdateCommand);
            return {};
        });

        const res = await check({
            scope: "IP",
            key: "127.0.0.1",
            capacity: 1,
            refillRate: 0, // pas de refill, tokens restent à 0
            cost: 2,
            table: TABLE,
            ttlSeconds: 60,
            nowMs: 2000 * 1000
        });

        expect(res.allowed).toBe(false);
        expect(res.status).toBe(429);
        expect(res.headers["Retry-After"]).toBeDefined();
        expect(res.headers["X-RateLimit-Remaining"]).toBe(String(Math.floor(res.remaining)));

        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    // ───────────────── WINDOW MODE (windowSeconds) ─────────────────

    it("window mode: nouvelle entrée, création de fenêtre et autorisation quand il reste des tokens", async () => {
        const nowSec = 1000;
        const windowSeconds = 60;

        // 1er appel: Get (aucun item)
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            expect(cmd.input.TableName).toBe(TABLE);
            expect(cmd.input.Key.PK).toBe("RL#WINDOW#client-1");
            expect(cmd.input.ConsistentRead).toBe(true);
            return {};
        });

        // 2e appel: Update de création
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(UpdateCommand);
            expect(cmd.input.TableName).toBe(TABLE);
            expect(cmd.input.Key.PK).toBe("RL#WINDOW#client-1");
            return {};
        });

        const res = await check({
            scope: "WINDOW",
            key: "client-1",
            capacity: 5,
            refillRate: 0, // ignoré en mode fenêtre
            cost: 1,
            table: TABLE,
            ttlSeconds: 120,
            windowSeconds,
            nowMs: nowSec * 1000
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(4);
        expect(res.headers["X-RateLimit-Limit"]).toBe("5");
        expect(res.headers["X-RateLimit-Remaining"]).toBe("4");
        expect(Number(res.headers["X-RateLimit-Reset"])).toBe(nowSec + windowSeconds);

        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it("window mode: nouvelle entrée mais limite dépassée, renvoie 429 avec Retry-After = windowSeconds", async () => {
        const nowSec = 1000;
        const windowSeconds = 60;

        // 1er appel: Get (aucun item)
        sendMock.mockImplementationOnce(async () => ({}));

        // 2e appel: Update de création
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(UpdateCommand);
            return {};
        });

        const res = await check({
            scope: "WINDOW",
            key: "client-2",
            capacity: 1,
            refillRate: 0,
            cost: 2, // capacité < coût => remaining = 0
            table: TABLE,
            ttlSeconds: 120,
            windowSeconds,
            nowMs: nowSec * 1000
        });

        expect(res.allowed).toBe(false);
        expect(res.status).toBe(429);
        expect(res.remaining).toBe(0);
        expect(res.headers["Retry-After"]).toBe(String(windowSeconds));
        expect(res.headers["X-RateLimit-Limit"]).toBe("1");
        expect(res.headers["X-RateLimit-Remaining"]).toBe("0");

        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it("window mode: fenêtre existante non expirée et plus assez de tokens -> 429 avec Retry-After basé sur la fin de fenêtre", async () => {
        const windowSeconds = 60;
        const nowSec = 1100;
        const windowStartedAt = 1050; // fenêtre de 60s, fin à 1110

        // 1er appel: Get avec un item existant mais tokens = 0
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            return {
                Item: {
                    PK: "RL#WINDOW#client-3",
                    tokens: 0,
                    windowStartedAt,
                    ver: 1
                }
            };
        });

        const res = await check({
            scope: "WINDOW",
            key: "client-3",
            capacity: 5,
            refillRate: 0,
            cost: 1,
            table: TABLE,
            ttlSeconds: 120,
            windowSeconds,
            nowMs: nowSec * 1000
        });

        expect(res.allowed).toBe(false);
        expect(res.status).toBe(429);
        expect(res.remaining).toBe(0);

        const reset = Number(res.headers["X-RateLimit-Reset"]);
        const retryAfter = Number(res.headers["Retry-After"]);

        expect(reset).toBe(windowStartedAt + windowSeconds);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(windowSeconds);

        // pas d'Update dans ce cas (juste refus)
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it("window mode: fenêtre existante, non expirée, consomme les tokens et update", async () => {
        const windowSeconds = 60;
        const nowSec = 1100;
        const windowStartedAt = 1050;

        // 1er appel: Get avec tokens suffisants
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            return {
                Item: {
                    PK: "RL#WINDOW#client-4",
                    tokens: 5,
                    windowStartedAt,
                    ver: 2
                }
            };
        });

        let updateInput;
        // 2e appel: Update consommation
        sendMock.mockImplementationOnce(async (cmd) => {
            expect(cmd).toBeInstanceOf(UpdateCommand);
            updateInput = cmd.input;
            return {};
        });

        const res = await check({
            scope: "WINDOW",
            key: "client-4",
            capacity: 5,
            refillRate: 0,
            cost: 1,
            table: TABLE,
            ttlSeconds: 120,
            windowSeconds,
            nowMs: nowSec * 1000
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(4); // 5 - 1
        expect(res.headers["X-RateLimit-Remaining"]).toBe("4");

        // vérifie l'Update (ver + 1, tokens mis à jour)
        expect(updateInput.ExpressionAttributeValues[":tokens"]).toBe(4);
        expect(updateInput.ExpressionAttributeValues[":prevVer"]).toBe(2);
        expect(updateInput.ExpressionAttributeValues[":ver"]).toBe(3);

        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    // ───────────────── ERREURS / VALIDATION ─────────────────

    it("lève une erreur quand la table est manquante et non fournie", async () => {
        delete process.env.RATE_LIMIT_TABLE;

        const localCheck = createCheckRateLimitBucket({ ddb: fakeDdb });

        await expect(
            localCheck({
                scope: "IP",
                key: "1.2.3.4",
                capacity: 1,
                refillRate: 0
            })
        ).rejects.toThrow("RATE_LIMIT_TABLE non défini");
    });

    it("lève une erreur quand la clé est manquante", async () => {
        const localCheck = createCheckRateLimitBucket({ ddb: fakeDdb });

        await expect(
            localCheck({
                scope: "IP",
                key: "",
                capacity: 1,
                refillRate: 0,
                table: TABLE
            })
        ).rejects.toThrow("rate limit key manquant");
    });
});
