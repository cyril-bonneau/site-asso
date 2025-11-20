// backend/rateLimit/rateLimitStorageDdb.test.js
import { describe, it, expect, vi } from "vitest";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
    buildRateLimitKey,
    loadBucket,
    saveBucket
} from "./rateLimitStorageDdb.js";

describe("rateLimitStorageDdb", () => {
    it("buildRateLimitKey construit une PK cohérente", () => {
        const pk = buildRateLimitKey("LOGIN", "user@example.com");
        expect(pk).toBe("RL#LOGIN#user@example.com");
    });

    it("loadBucket utilise GetCommand et renvoie l'item", async () => {
        const fakeItem = { tokens: 3, windowStartedAt: 1234 };
        const send = vi.fn(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            expect(cmd.input.TableName).toBe("RateLimitTable");
            expect(cmd.input.Key).toEqual({ PK: "RL#SCOPE#KEY" });
            return { Item: fakeItem };
        });

        const fakeDdb = { send };

        const item = await loadBucket({
            ddb: fakeDdb,
            tableName: "RateLimitTable",
            pk: "RL#SCOPE#KEY"
        });

        expect(item).toEqual(fakeItem);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("loadBucket renvoie null quand aucun item n'est trouvé", async () => {
        const send = vi.fn(async (cmd) => {
            expect(cmd).toBeInstanceOf(GetCommand);
            return {};
        });

        const fakeDdb = { send };

        const item = await loadBucket({
            ddb: fakeDdb,
            tableName: "RateLimitTable",
            pk: "RL#SCOPE#KEY"
        });

        expect(item).toBeNull();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("saveBucket utilise UpdateCommand avec les bons attributs", async () => {
        let capturedInput;
        const send = vi.fn(async (cmd) => {
            expect(cmd).toBeInstanceOf(UpdateCommand);
            capturedInput = cmd.input;
            return {};
        });

        const fakeDdb = { send };

        await saveBucket({
            ddb: fakeDdb,
            tableName: "RateLimitTable",
            pk: "RL#SCOPE#KEY",
            tokens: 7,
            nowSec: 1000,
            ttlSeconds: 60
        });

        expect(send).toHaveBeenCalledTimes(1);
        expect(capturedInput.TableName).toBe("RateLimitTable");
        expect(capturedInput.Key).toEqual({ PK: "RL#SCOPE#KEY" });

        const values = capturedInput.ExpressionAttributeValues;
        expect(values[":tokens"]).toBe(7);
        expect(values[":win"]).toBe(1000);
        expect(values[":ttl"]).toBe(1060); // 1000 + 60
        expect(values[":ver"]).toBe(1);
    });
});
