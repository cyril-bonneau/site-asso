// withRateLimit.js
import { checkRateLimitBucket } from "./checkRateLimitBucket.js";

export function withRateLimit(handler, opts) {
    const {
        scope = "IP",
        capacity = 10,
        refillRate = 0.1, // 1 token/s
        cost = 1,
        keyFromEvent = (event) => {
            return event?.requestContext?.http?.sourceIp
                || event?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()
                || "unknown";
        },
        windowSeconds
    } = opts || {};

    return async (event, context) => {
        const key = keyFromEvent(event);
        const rl = await checkRateLimitBucket({
            scope, key, capacity, refillRate, cost, windowSeconds
        });

        if (!rl.allowed) {
            return {
                statusCode: rl.status ?? 429,
                headers: {
                    "Content-Type": "application/json",
                    ...rl.headers
                },
                body: JSON.stringify({ message: "Rate limit exceeded" })
            };
        }

        const resp = await handler(event, context);
        return {
            ...resp,
            headers: {
                ...(resp?.headers || {}),
                ...rl.headers
            }
        };
    };
}
