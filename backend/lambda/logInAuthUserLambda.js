import { checkPasswordByEmail } from "../dal/checkPasswordByEmail.js";
import { normalizeEmail, hashRefreshToken, json, buildRefreshCookie, generateRefreshToken } from "../helpers/toolbox.js";
import { withRateLimit } from "../rateLimit/withRateLimit.js";
import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js";
import { storeRefreshToken } from "../dal/tokenStore.js";

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
        let data;
        try {
            data = JSON.parse(event.body);
        } catch (err) {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" })
        }

        const { email, password } = data

        if (!email || !password) {
            return json(400, { ok: false, message: "MISSING_CREDENTIALS" })
        }

        return loginCore({ email, password })

    } catch (err) {
        console.error("Fatal error in login handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function loginCore({ email, password }) {

    try {

        const { check, userId = undefined, privilege = undefined } = await checkPasswordByEmail({ password, email: normalizeEmail(email) })

        console.log("privilege", privilege)
        if (!check) {
            return json(403, { ok: false, message: "WRONG_CREDENTIALS" });
        }

        const payload = { userId, email: normalizeEmail(email), privilege };
        const accessToken = await signAccessTokenWithKms(payload);

        console.log("accessToken", accessToken)

        const refreshToken = await generateRefreshToken(userId, REFRESH_JWT_HMAC);

        console.log("refreshToken", refreshToken)

        const hashedRefreshToken = hashRefreshToken(refreshToken);

        console.log("hashedRefreshToken", hashedRefreshToken)

        const res = await storeRefreshToken(hashedRefreshToken, userId);

        console.log("storeRefreshToken result", res)

        if (res.$metadata.httpStatusCode !== 200) {
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        const cookieString = buildRefreshCookie(refreshToken);

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