// backend/rateLimit/withRateLimit.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// IMPORTANT : mock AVANT les imports du module testé
vi.mock("./checkRateLimitBucket.js", () => ({
    checkRateLimitBucket: vi.fn()
}));

import { withRateLimit } from "./withRateLimit.js";
import { checkRateLimitBucket } from "./checkRateLimitBucket.js";

describe("withRateLimit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("appelle le handler et merge les headers quand allowed", async () => {
        checkRateLimitBucket.mockResolvedValue({
            allowed: true,
            remaining: 9,
            reset: 1234,
            headers: {
                "X-RateLimit-Limit": "10",
                "X-RateLimit-Remaining": "9",
                "X-RateLimit-Reset": "1234"
            }
        });

        const handler = vi.fn(async () => ({
            statusCode: 200,
            body: JSON.stringify({ ok: true }),
            headers: { "Content-Type": "application/json" }
        }));

        const wrapped = withRateLimit(handler, {
            scope: "IP",
            capacity: 10,
            refillRate: 0.1
        });

        const event = {
            requestContext: { http: { sourceIp: "1.2.3.4" } }
        };

        const resp = await wrapped(event, {});

        expect(checkRateLimitBucket).toHaveBeenCalledTimes(1);
        expect(checkRateLimitBucket).toHaveBeenCalledWith({
            scope: "IP",
            key: "1.2.3.4",
            capacity: 10,
            refillRate: 0.1,
            cost: 1
        });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(resp.statusCode).toBe(200);
        expect(resp.headers["Content-Type"]).toBe("application/json");
        expect(resp.headers["X-RateLimit-Limit"]).toBe("10");
        expect(resp.headers["X-RateLimit-Remaining"]).toBe("9");
    });

    it("court-circuite et renvoie 429 quand not allowed", async () => {
        checkRateLimitBucket.mockResolvedValue({
            allowed: false,
            status: 429,
            remaining: 0,
            reset: 999,
            headers: {
                "X-RateLimit-Limit": "10",
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": "999"
            }
        });

        const handler = vi.fn();

        const wrapped = withRateLimit(handler, {
            scope: "IP",
            capacity: 10,
            refillRate: 0.1
        });

        const event = {
            requestContext: { http: { sourceIp: "1.2.3.4" } }
        };

        const resp = await wrapped(event, {});

        expect(handler).not.toHaveBeenCalled();
        expect(resp.statusCode).toBe(429);
        expect(resp.body).toBe(JSON.stringify({ message: "Rate limit exceeded" }));
        expect(resp.headers["X-RateLimit-Remaining"]).toBe("0");
    });

    it("utilise le header x-forwarded-for quand sourceIp est absent", async () => {
        checkRateLimitBucket.mockResolvedValue({
            allowed: true,
            remaining: 5,
            reset: 10,
            headers: {}
        });

        const handler = vi.fn(async () => ({
            statusCode: 200,
            body: "ok"
        }));

        const wrapped = withRateLimit(handler, {});

        const event = {
            headers: {
                "x-forwarded-for": "5.6.7.8, 9.9.9.9"
            },
            requestContext: { http: {} }
        };

        await wrapped(event, {});

        expect(checkRateLimitBucket).toHaveBeenCalledWith({
            scope: "IP",
            key: "5.6.7.8",
            capacity: 10,
            refillRate: 0.1,
            cost: 1
        });
    });
});
