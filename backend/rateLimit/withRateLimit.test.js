// backend/rateLimit/withRateLimit.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

const checkRateLimitBucketMock = vi.fn();

vi.mock("./checkRateLimitBucket.js", () => ({
    checkRateLimitBucket: checkRateLimitBucketMock,
}));

import { withRateLimit } from "./withRateLimit.js";

describe("withRateLimit", () => {
    beforeEach(() => {
        checkRateLimitBucketMock.mockReset();
    });

    it("devrait appeler le handler quand le rate-limit autorise", async () => {
        checkRateLimitBucketMock.mockResolvedValueOnce({
            allowed: true,
            remaining: 2,
            reset: 1000,
            headers: {
                "X-RateLimit-Limit": "3",
                "X-RateLimit-Remaining": "2",
            },
        });

        const handler = vi.fn().mockResolvedValue({
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ok: true }),
        });

        const wrapped = withRateLimit(handler, {
            scope: "login",
            capacity: 3,
            refillRate: 1,
            cost: 1,
            keyFromEvent: () => "EMAIL#foo@example.com",
        });

        const event = { body: "{}" };
        const context = {};

        const resp = await wrapped(event, context);

        expect(checkRateLimitBucketMock).toHaveBeenCalledWith({
            scope: "login",
            key: "EMAIL#foo@example.com",
            capacity: 3,
            refillRate: 1,
            cost: 1,
            windowSeconds: undefined,
        });

        expect(handler).toHaveBeenCalledWith(event, context);

        expect(resp.statusCode).toBe(200);
        expect(resp.headers["Content-Type"]).toBe("application/json");
        expect(resp.headers["X-RateLimit-Limit"]).toBe("3");
        expect(resp.headers["X-RateLimit-Remaining"]).toBe("2");
        expect(resp.body).toBe(JSON.stringify({ ok: true }));
    });

    it("ne doit pas appeler le handler et renvoyer 429 quand le rate-limit refuse", async () => {
        checkRateLimitBucketMock.mockResolvedValueOnce({
            allowed: false,
            remaining: 0,
            reset: 1000,
            status: 429,
            headers: {
                "X-RateLimit-Limit": "3",
                "X-RateLimit-Remaining": "0",
                "Retry-After": "60",
            },
        });

        const handler = vi.fn();

        const wrapped = withRateLimit(handler, {
            scope: "login",
            capacity: 3,
            refillRate: 1,
            cost: 1,
            keyFromEvent: () => "EMAIL#foo@example.com",
        });

        const resp = await wrapped({ body: "{}" }, {});

        expect(handler).not.toHaveBeenCalled();

        expect(resp.statusCode).toBe(429);
        expect(resp.headers["X-RateLimit-Limit"]).toBe("3");
        expect(resp.headers["X-RateLimit-Remaining"]).toBe("0");
        expect(resp.headers["Retry-After"]).toBe("60");
        expect(resp.body).toBe(JSON.stringify({ message: "Rate limit exceeded" }));
    });
});
