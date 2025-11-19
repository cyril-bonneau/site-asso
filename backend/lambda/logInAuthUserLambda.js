import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { checkPasswordByEmail } from "../helpers/checkPasswordByEmail";
import { json } from "../helpers/json";
import { normalizeEmail } from "../helpers/toolbox";
import { withRateLimit } from "../rateLimit/withRateLimit";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export const handler = async (event) => {
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

        const normalizedEmail = normalizeEmail(email);

        try {
            return loginWithRateLimit({
                email: normalizedEmail,
                password
            });
        } catch (err) {
            if (err?.code === "RATE_LIMIT_EXCEEDED") {
                return json(429, {
                    ok: false,
                    message: "TOO_MANY_REQUESTS",
                    retryAfterSec: err.retryAfterSec,
                });
            }

            console.error("Error in login handler:", err);
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

    } catch (err) {
        console.error("Fatal error in login handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

const loginWithRateLimit = withRateLimit(loginCore, {
    scope: "login",
    capacity: 3,
    keySelector: (({ email }) => `EMAIL#${email}`),
    refillRate: 0.005,
    windowSeconds: true
})

async function loginCore(event) {
    const { email, password } = JSON.parse(event.body);

    const check = await checkPasswordByEmail({ password, email: normalizeEmail(email) })

    if (check) {
        return json(403, { ok: false, message: "WRONG_CREDENTIALS" });
    }

    return json(200, {
        ok: true,
        // accessToken,
        // refreshToken,
        // userId,
    });
}