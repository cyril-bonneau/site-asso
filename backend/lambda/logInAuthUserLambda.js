import { checkPasswordByEmail } from "../dal/checkPasswordByEmail.js";
import { normalizeEmail, json } from "../helpers/toolbox.js";
import { withRateLimit } from "../rateLimit/withRateLimit.js";
import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js";
import { generateNewRefreshToken } from "../helpers/generateNewRefreshToken.js";
import { validateInput } from "../zod/validateInput.js";
import { loginInputSchema } from "../zod/zodSchema/loginInputValidation.js";
import crypto from "crypto";

export const handler = withRateLimit(handlerCore, {
    scope: "login",
    capacity: 3,
    refillRate: 0.005,
    windowSeconds: true
})

const REFRESH_JWT_HMAC = crypto
    .createSecretKey(Buffer.from(process.env.REFRESH_JWT_HMAC, "utf-8"));

async function handlerCore(event) {
    try {
        const input = validateInput(event, loginInputSchema);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }

        const { email, password } = input.body.data;

        return loginCore({ email, password })

    } catch (err) {
        console.error("Fatal error in login handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function loginCore({ email, password }) {

    try {

        const { check, userId, privilege } = await checkPasswordByEmail({ password, email: normalizeEmail(email) })

        console.log("privilege", privilege)
        if (!check) {
            return json(403, { ok: false, message: "WRONG_CREDENTIALS" });
        }

        const payload = { userId, privilege };
        const accessToken = await signAccessTokenWithKms(payload);

        // console.log("accessToken", accessToken)

        const cookieString = await generateNewRefreshToken(userId, REFRESH_JWT_HMAC);

        return json(
            200,
            {
                ok: true,
                userId: userId,
                message: "LOGGED_IN",
                accessToken,
            },
            {
                "Set-Cookie": cookieString
            }
        );

    } catch (err) {
        if (err?.message === "AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH") {
            return json(404, { ok: false, message: "AUTH_NOT_FOUND" });
        }
        console.warn("loginCore error", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}