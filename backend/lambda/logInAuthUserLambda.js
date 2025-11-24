import { checkPasswordByEmail } from "../dal/checkPasswordByEmail.js";
import { json } from "../helpers/json.js";
import { normalizeEmail } from "../helpers/toolbox.js";
import { withRateLimit } from "../rateLimit/withRateLimit.js";

export const handler = withRateLimit(handlerCore, {
    scope: "login",
    capacity: 3,
    refillRate: 0.005,
    windowSeconds: true
})

async function handlerCore(event) {
    try {
        let data;
        try {
            data = JSON.parse(event.body || {});
        } catch (err) {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" })
        }

        const { email, password } = data

        if (!email || !password) {
            return json(400, { ok: false, message: "MISSING_CREDENTIALS" })
        }

        try {
            loginCore({ email, password })
        } catch (err) {
            if (err?.code === "RATE_LIMIT_EXCEEDED") {
                return json(429, {
                    ok: false,
                    message: "TOO_MANY_REQUESTS",
                    retryAfterSec: err.retryAfterSec,
                });
            }

            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

    } catch (err) {
        console.error("Fatal error in login handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function loginCore({ email, password }) {

    const check = await checkPasswordByEmail({ password, email: normalizeEmail(email) })

    if (!check) {
        return json(403, { ok: false, message: "WRONG_CREDENTIALS" });
    }

    return json(200, {
        ok: true,
        // accessToken,
        // refreshToken,
        // userId,
    });
}