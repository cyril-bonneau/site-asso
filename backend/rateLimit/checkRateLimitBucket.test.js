import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock des clients AWS
vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => {
    const sendMock = vi.fn();

    return {
        DynamoDBDocumentClient: {
            from: () => ({ send: sendMock }),
        },
        GetCommand: vi.fn(),
        UpdateCommand: vi.fn(),
        // On expose le mock pour les tests
        __sendMock: sendMock,
    };
});

// ⚠️ On importe APRES les mocks
import { checkRateLimitBucket } from "./checkRateLimitBucket.js";
// Et on récupère le mock exposé par le module mocké
import { __sendMock as sendMock } from "@aws-sdk/lib-dynamodb";

describe("checkRateLimitBucket", () => {
    const tableName = "RateLimitTable";

    beforeEach(() => {
        sendMock.mockReset();
        vi.spyOn(Date, "now").mockReturnValue(1_000_000); // 1000s
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
            refillRate: 1,
            cost: 1,
            table: tableName,
            ttlSeconds: 86400,
            windowSeconds: 600,
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(2);
        expect(res.reset).toBe(1000 + 600);
        expect(res.headers).toMatchObject({
            "X-RateLimit-Limit": "3",
            "X-RateLimit-Remaining": "2",
            "X-RateLimit-Reset": String(1000 + 600),
        });
        expect(sendMock).toHaveBeenCalledTimes(2);
    });

    it("devrait bloquer quand tokens=0 dans la fenêtre (windowSeconds)", async () => {
        sendMock.mockResolvedValueOnce({
            Item: {
                PK: "RL#login#EMAIL#foo@example.com",
                tokens: 0,
                windowStartedAt: 1000,
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
        expect(res.reset).toBe(1000 + 600);
        expect(res.headers).toMatchObject({
            "X-RateLimit-Limit": "3",
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(1000 + 600),
        });
        expect(res.headers["Retry-After"]).toBeDefined();
        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it("devrait créer un bucket classique au premier appel (mode token bucket)", async () => {
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
        });

        expect(res.allowed).toBe(true);
        expect(res.remaining).toBe(2);
        expect(res.headers).toMatchObject({
            "X-RateLimit-Limit": "3",
            "X-RateLimit-Remaining": "2",
        });
        expect(sendMock).toHaveBeenCalledTimes(2);
    });
});
