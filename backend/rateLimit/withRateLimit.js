import { checkRateLimitBucket } from "./checkRateLimitBucket.js";
import { normalizeEmail } from "../helpers/toolbox.js"

export function withRateLimit(handler, opts) {
    const {
        scope,
        capacity = 10,
        refillRate = 0.1, // 1 token toutes les 10s
        cost = 1,
        keyFromEvent = (event) => {
            if (!event || event.body == null) {
                throw new RateLimitKeyError("Request body is required")
            }

            let body;

            if (typeof event.body === "string") {
                try {
                    body = JSON.parse(event.body)
                } catch (err) {
                    throw new RateLimitKeyError("Request body must be valid JSON")
                }
            } else if (typeof event.body === "object" && event.body !== null) {
                body = event.body
            } else {
                throw new RateLimitKeyError("Request body has unsupported type");
            }

            if (body.email || body.oldEmail) {
                return "EMAIL#" + normalizeEmail(body.email)
            }

            const ip = event?.requestContext?.http?.sourceIp ||
                event?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim()

            if (!ip) {
                throw new RateLimitKeyError("Request body has unsupported type");
            }

            return `IP#${ip}`
        }
    } = opts || {};

    return async (event, context) => {

        let key;

        try {
            key = keyFromEvent(event)
        } catch (err) {
            if (err instanceof RateLimitKeyError) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ ok: false, message: err.message })
                }
            }
            throw err
        }

        const rl = await checkRateLimitBucket({
            scope,
            key,
            capacity,
            refillRate,
            cost
        });

        if (!rl.allowed) {
            return {
                statusCode: rl.status ?? 429,
                headers: rl.headers,
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

class RateLimitKeyError extends Error {
    constructor(message) {
        super(message);
        this.name = "RateLimitKeyError";
    }
}