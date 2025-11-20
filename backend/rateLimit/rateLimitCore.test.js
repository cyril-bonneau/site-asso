// backend/rateLimit/rateLimitCore.test.js
import { describe, it, expect } from "vitest";
import { computeBucketState } from "./rateLimitCore.js";

describe("computeBucketState", () => {
    it("autorise et décrémente les tokens pour un nouveau seau", () => {
        const res = computeBucketState({
            capacity: 10,
            refillRate: 0.1,
            cost: 1,
            nowSec: 1000,
            item: null
        });

        expect(res.allowed).toBe(true);
        expect(res.newTokens).toBeCloseTo(9);
        expect(res.capacity).toBe(10);
        expect(res.retryAfter).toBe(0);
    });

    it("utilise les valeurs par défaut quand les paramètres sont invalides", () => {
        const res = computeBucketState({
            capacity: 0,
            refillRate: -5,
            cost: 0,
            nowSec: 1000,
            item: null
        });

        // capacity -> 10, cost -> 1, refillRate -> 0
        expect(res.capacity).toBe(10);
        expect(res.allowed).toBe(true);
        expect(res.newTokens).toBeCloseTo(9);
    });

    it("refill les tokens en fonction du temps écoulé", () => {
        const res = computeBucketState({
            capacity: 10,
            refillRate: 1, // 1 token / sec
            cost: 1,
            nowSec: 1000,
            item: {
                tokens: 0,
                windowStartedAt: 990 // 10s plus tôt
            }
        });

        // 0 + 10 * 1 = 10 -> min(10, 10) => 10, -1 => 9
        expect(res.allowed).toBe(true);
        expect(res.newTokens).toBeCloseTo(9);
        expect(res.capacity).toBe(10);
    });

    it("refuse quand pas assez de tokens et renvoie un retryAfter > 0", () => {
        const res = computeBucketState({
            capacity: 5,
            refillRate: 1,
            cost: 5,
            nowSec: 1000,
            item: {
                tokens: 0,
                windowStartedAt: 999 // 1s
            }
        });

        // prevTokens=0, elapsed=1, refilled=1, filled=1
        // cost=5 -> remaining=-4 => allowed=false, newTokens=1
        expect(res.allowed).toBe(false);
        expect(res.newTokens).toBeCloseTo(1);
        expect(res.retryAfter).toBeGreaterThan(0);
    });

    it("calcule un resetSec cohérent (temps de plein du seau)", () => {
        const res = computeBucketState({
            capacity: 10,
            refillRate: 1,
            cost: 1,
            nowSec: 1000,
            item: {
                tokens: 5,
                windowStartedAt: 995
            }
        });

        // on ne vérifie pas la valeur exacte, juste que c'est >= nowSec
        expect(res.resetSec).toBeGreaterThanOrEqual(1000);
    });
});
