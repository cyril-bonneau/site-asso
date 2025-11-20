// backend/rateLimit/rateLimitCore.js

/**
 * Calcule le nouvel état du seau de rate limit.
 *
 * @param {Object} p
 * @param {number} p.capacity      - Nombre max de tokens dans le seau
 * @param {number} p.refillRate    - Tokens par seconde
 * @param {number} p.cost          - Coût de l'opération
 * @param {number} p.nowSec        - Timestamp actuel en secondes
 * @param {Object|null} p.item     - État actuel du seau { tokens, windowStartedAt }
 *
 * @returns {{
 *   allowed: boolean,
 *   newTokens: number,
 *   resetSec: number,
 *   retryAfter: number,
 *   capacity: number
 * }}
 */
export function computeBucketState({ capacity, refillRate, cost, nowSec, item }) {
    const capacityInt =
        Number.isFinite(capacity) && capacity > 0 ? capacity : 10;
    const costInt =
        Number.isFinite(cost) && cost > 0 ? cost : 1;
    const refillRateFloat =
        Number.isFinite(refillRate) && refillRate >= 0 ? refillRate : 0;

    const prevTokens = typeof item?.tokens === "number"
        ? item.tokens
        : capacityInt;

    const prevWindow = typeof item?.windowStartedAt === "number"
        ? item.windowStartedAt
        : nowSec;

    const elapsed = Math.max(0, nowSec - prevWindow);

    // On remplit le seau en fonction du temps écoulé
    const refilled = prevTokens + elapsed * refillRateFloat;
    const filled = Math.min(capacityInt, refilled);

    // On tente de payer le coût
    const remaining = filled - costInt;
    const allowed = remaining >= 0;

    // Si refus, on ne débite pas (on garde filled)
    const newTokens = allowed ? remaining : filled;

    // Temps jusqu'au full refill (utile pour X-RateLimit-Reset)
    const safeRate = refillRateFloat || 1e-9;
    const missingToFull = capacityInt - newTokens;
    const resetSec =
        missingToFull <= 0
            ? nowSec
            : Math.floor(nowSec + missingToFull / safeRate);

    // Temps avant de pouvoir payer au moins un costInt si refus
    let retryAfter = 0;
    if (!allowed) {
        const deficit = costInt - filled;
        retryAfter = deficit > 0 ? Math.ceil(deficit / safeRate) : 0;
    }

    return {
        allowed,
        newTokens,
        resetSec,
        retryAfter,
        capacity: capacityInt
    };
}
