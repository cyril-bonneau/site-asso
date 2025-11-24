// backend/rateLimit/withRateLimit.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

// IMPORTANT : mock AVANT les imports du module testé
vi.mock("./checkRateLimitBucket.js", () => ({
    checkRateLimitBucket: vi.fn()
}));

import { withRateLimit } from "./withRateLimit.js";
import { checkRateLimitBucket } from "./checkRateLimitBucket.js";
import { normalizeEmail } from "../helpers/toolbox.js";

describe("withRateLimit", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("utilise EMAIL#... comme clé quand un email est présent dans le body et merge les headers quand allowed", async () => {
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
            scope: "LOGIN",
            capacity: 20,
            refillRate: 0.5
            // cost par défaut = 1
        });

        const rawEmail = "  Foo.Bar+test@Example.COM  ";
        const event = {
            body: JSON.stringify({ email: rawEmail }),
            requestContext: {
                http: {
                    sourceIp: "1.2.3.4" // ne sera pas utilisé car email présent
                }
            }
        };

        const resp = await wrapped(event, {});

        // checkRateLimitBucket a bien été appelé avec une clé EMAIL#normalisée
        expect(checkRateLimitBucket).toHaveBeenCalledTimes(1);
        const arg = checkRateLimitBucket.mock.calls[0][0];

        expect(arg.scope).toBe("LOGIN");
        expect(arg.capacity).toBe(20);
        expect(arg.refillRate).toBe(0.5);
        expect(arg.cost).toBe(1);
        expect(arg.key).toBe("EMAIL#" + normalizeEmail(rawEmail));

        // le handler métier a bien été appelé
        expect(handler).toHaveBeenCalledTimes(1);

        // la réponse finale est bien celle du handler + les headers RL
        expect(resp.statusCode).toBe(200);
        expect(resp.body).toBe(JSON.stringify({ ok: true }));
        expect(resp.headers["Content-Type"]).toBe("application/json");
        expect(resp.headers["X-RateLimit-Limit"]).toBe("10");
        expect(resp.headers["X-RateLimit-Remaining"]).toBe("9");
        expect(resp.headers["X-RateLimit-Reset"]).toBe("1234");
    });

    it("utilise IP#... comme clé quand il n'y a pas d'email mais une sourceIp, et allowed = true", async () => {
        checkRateLimitBucket.mockResolvedValue({
            allowed: true,
            remaining: 5,
            reset: 42,
            headers: {}
        });

        const handler = vi.fn(async () => ({
            statusCode: 200,
            body: "ok"
        }));

        const wrapped = withRateLimit(handler, {
            scope: "IP",
            capacity: 10,
            refillRate: 0.1
        });

        const event = {
            body: JSON.stringify({}), // body requis, même vide
            requestContext: {
                http: {
                    sourceIp: "5.6.7.8"
                }
            },
            headers: {}
        };

        await wrapped(event, {});

        expect(checkRateLimitBucket).toHaveBeenCalledTimes(1);
        expect(checkRateLimitBucket).toHaveBeenCalledWith({
            scope: "IP",
            key: "IP#5.6.7.8",
            capacity: 10,
            refillRate: 0.1,
            cost: 1
        });

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it("utilise IP#... depuis x-forwarded-for quand sourceIp est absent", async () => {
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

        const wrapped = withRateLimit(handler, {
            scope: "IP",
            capacity: 10,
            refillRate: 0.1
        });

        const event = {
            body: JSON.stringify({}), // body requis
            headers: {
                "x-forwarded-for": "5.6.7.8, 9.9.9.9"
            },
            requestContext: { http: {} }
        };

        await wrapped(event, {});

        expect(checkRateLimitBucket).toHaveBeenCalledTimes(1);
        expect(checkRateLimitBucket).toHaveBeenCalledWith({
            scope: "IP",
            key: "IP#5.6.7.8", // premier IP du x-forwarded-for
            capacity: 10,
            refillRate: 0.1,
            cost: 1
        });
    });

    it("court-circuite et renvoie 429 quand not allowed (en utilisant un keyFromEvent custom pour simplifier)", async () => {
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
            refillRate: 0.1,
            keyFromEvent: () => "IP#1.2.3.4" // on bypass la logique body/email ici
        });

        const event = {}; // pas besoin de body dans ce cas, on ne l'utilise pas

        const resp = await wrapped(event, {});

        // le handler métier NE doit PAS être appelé
        expect(handler).not.toHaveBeenCalled();

        // on renvoie bien la 429 avec les headers de rate-limit
        expect(resp.statusCode).toBe(429);
        expect(resp.body).toBe(JSON.stringify({ message: "Rate limit exceeded" }));
        expect(resp.headers["X-RateLimit-Limit"]).toBe("10");
        expect(resp.headers["X-RateLimit-Remaining"]).toBe("0");
        expect(resp.headers["X-RateLimit-Reset"]).toBe("999");
    });

    it("renvoie 400 quand le body est manquant avec keyFromEvent par défaut", async () => {
        const handler = vi.fn();

        const wrapped = withRateLimit(handler, {
            scope: "IP"
        });

        const event = {
            requestContext: { http: { sourceIp: "1.2.3.4" } }
            // pas de body → doit déclencher RateLimitKeyError("Request body is required")
        };

        const resp = await wrapped(event, {});

        expect(handler).not.toHaveBeenCalled();
        expect(checkRateLimitBucket).not.toHaveBeenCalled();
        expect(resp.statusCode).toBe(400);
        expect(resp.body).toContain("Request body is required");
    });

    it("renvoie 400 quand le body contient un JSON invalide (keyFromEvent par défaut)", async () => {
        const handler = vi.fn();

        const wrapped = withRateLimit(handler, {
            scope: "IP"
        });

        const event = {
            requestContext: { http: { sourceIp: "1.2.3.4" } },
            body: "{ invalid json" // va faire planter JSON.parse
        };

        const resp = await wrapped(event, {});

        expect(handler).not.toHaveBeenCalled();
        expect(checkRateLimitBucket).not.toHaveBeenCalled();
        expect(resp.statusCode).toBe(400);
        expect(resp.body).toContain("Request body must be valid JSON");
    });

    it("renvoie 400 quand aucune email ni IP ne peuvent être déterminés", async () => {
        const handler = vi.fn();

        const wrapped = withRateLimit(handler, {
            scope: "IP"
        });

        const event = {
            body: JSON.stringify({}), // body ok, mais pas d'email
            // pas de requestContext.http.sourceIp
            headers: {
                // pas de x-forwarded-for non plus
            }
        };

        const resp = await wrapped(event, {});

        expect(handler).not.toHaveBeenCalled();
        expect(checkRateLimitBucket).not.toHaveBeenCalled();
        expect(resp.statusCode).toBe(400);
        expect(resp.body).toContain("Request body has unsupported type");
    });
});
