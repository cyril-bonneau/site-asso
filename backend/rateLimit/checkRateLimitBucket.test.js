// backend/rateLimit/checkRateLimitBucket.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn();

// Mock des clients AWS
vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => {
    sendMock = vi.fn();
    return {
        DynamoDBDocumentClient: {
            from: () => ({ send: sendMock }),
        },
        GetCommand: vi.fn(),
        UpdateCommand: vi.fn(),
    };
});

// On importe APRES les mocks
import { checkRateLimitBucket } from "./checkRateLimitBucket.js";

describe("checkRateLimitBucket", () => {
    const tableName = "RateLimitTable";

    beforeEach(() => {
        sendMock.mockReset();
        vi.spyOn(Date, "now").mockReturnValue(1_000_000); // 1 000 000 ms → 1000s
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("devrait créer une fenêtre fixe au premier appel (windowSeconds)", async () => {
        // 1er send = GetItem → aucun item
        // 2e send = UpdateItem → création
        sendMock
            .mockResolvedValueOnce({ Item: undefined }) // GetItem
            .mockResolvedValueOnce({}); // UpdateItem OK

        const res = await checkRateLimitBucket({
            scope: "login",
            key: "EMAIL#foo@example.com",
            capacity: 3,
            refillRate: 1, // ignoré en mode fenêtre, mais demandé par la signature
            cost: 1,
            table: tableName,
            ttlSeconds: 86400,
            windowSeconds: 600, // 10 minutes
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(2); // 3 - 1
        expect(res.status).toBeUndefined();

        // nowSec = 1000, donc reset = 1000 + 600
        expect(res.reset).toBe(1000 + 600);

        expect(res.headers).toMatchObject({
            "X-RateLimit-Limit": "3",
            "X-RateLimit-Remaining": "2",
            "X-RateLimit-Reset": String(1000 + 600),
        });

        // 2 appels à ddb.send : Get puis Update
        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it("devrait bloquer quand tokens=0 dans la fenêtre (windowSeconds)", async () => {
        // GetItem retourne un item avec tokens = 0
        sendMock.mockResolvedValueOnce({
            Item: {
                PK: "RL#login#EMAIL#foo@example.com",
                tokens: 0,
                windowStartedAt: 1000, // même que nowSec → elapsed = 0 < windowSeconds
                ver: 1,
            },
        });

        const res = await checkRateLimitBucket({
            scope: "login",
            key: "EMAIL#foo@example.com",
            capacity: 3,
            refillRate: 1,
            cost: 1,
            table: tableName,
            ttlSeconds: 86400,
            windowSeconds: 600,
        });

        expect(res.allowed).toBe(false);
        expect(res.status).toBe(429);
        expect(res.remaining).toBe(0);

        // reset = windowStartedAt + windowSeconds = 1000 + 600
        expect(res.reset).toBe(1000 + 600);

        expect(res.headers).toMatchObject({
            "X-RateLimit-Limit": "3",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(1000 + 600),
        });
        expect(res.headers["Retry-After"]).toBeDefined();

        // Pas d'UpdateItem → un seul appel (GetItem)
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it("devrait créer un bucket classique au premier appel (mode token bucket)", async () => {
        // GetItem → aucun item
        // UpdateItem → création bucket classique
        sendMock
            .mockResolvedValueOnce({ Item: undefined }) // GetItem
            .mockResolvedValueOnce({}); // UpdateItem

        const res = await checkRateLimitBucket({
            scope: "IP",
            key: "127.0.0.1",
            capacity: 3,
            refillRate: 1,
            cost: 1,
            table: tableName,
            ttlSeconds: 86400,
            // pas de windowSeconds → mode token bucket
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(2); // 3 - 1
        expect(res.status).toBeUndefined();

        expect(res.headers).toMatchObject({
            "X-RateLimit-Limit": "3",
            "X-RateLimit-Remaining": "2",
        });

        expect(sendMock).toHaveBeenCalledTimes(2);
    });
});
