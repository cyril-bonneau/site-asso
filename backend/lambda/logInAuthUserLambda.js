import { checkPasswordByEmail } from "../dal/checkPasswordByEmail.js";
import { json } from "../helpers/toolbox.js";
import { withRateLimit } from "../rateLimit/withRateLimit.js";
import { withOptionalAuth } from "../middlewares/withAuthMiddlewares.js";
import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js";
import { generateNewRefreshToken } from "../helpers/generateNewRefreshToken.js";
import { validateInput } from "../zod/validateInput.js";
import { loginInputSchema } from "../zod/zodSchema/loginInputValidation.js";
import crypto from "crypto";

const REFRESH_JWT_HMAC = crypto
    .createSecretKey(Buffer.from(process.env.REFRESH_JWT_HMAC, "utf-8"));

/**
 * Handler de connexion.
 *
 * Composition des middlewares (ordre d'exécution) :
 *   withRateLimit → withOptionalAuth → handlerCore
 *
 * withOptionalAuth permet de détecter si l'utilisateur a déjà un token valide
 * sans bloquer la route pour les utilisateurs non connectés.
 */
export const handler = withRateLimit(withOptionalAuth(handlerCore), {
    scope: "login",
    capacity: 3,
    refillRate: 0.005,
    windowSeconds: true,
});

/**
 * Corps du handler de connexion.
 *
 * Si l'utilisateur présente un access token encore valide → on retourne
 * ALREADY_AUTHENTICATED sans refaire de vérification du mot de passe.
 *
 * Sinon → flux de connexion classique : vérification email/mot de passe,
 * émission d'un nouvel access token et d'un refresh token cookie.
 *
 * @param {Object} event    - Événement Lambda
 * @param {Object} _context - Contexte Lambda (non utilisé)
 * @param {Object} param2   - Contexte auth injecté par withOptionalAuth
 * @param {Object|null} param2.auth - { userId, privilege } si connecté, null sinon
 */
async function handlerCore(event, _context, { auth }) {
    try {

        // --- Utilisateur déjà authentifié ---
        // Son access token est encore valide → pas besoin de refaire un login complet.
        if (auth !== null) {
            console.log(`[loginUser] Utilisateur déjà authentifié (userId: ${auth.userId}) - accès à /login autorisé mais pas de nouveau token émis.`);
            return json(200, {
                ok: true,
                userId: auth.userId,
                message: "ALREADY_AUTHENTICATED",
            });
        }

        // --- Utilisateur non authentifié → flux de login classique ---
        const input = validateInput(event, loginInputSchema);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }

        const { email, password } = input.body.data;

        console.log(`[loginUser] Tentative de connexion pour email: ${email} - User-Agent: ${event.headers ? event.headers["user-agent"] : "unknown"}`);

        return await loginCore({ email, password });

    } catch (err) {
        console.error("[loginUser] Erreur fatale dans le handler :", err.message);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

/**
 * Vérifie les credentials, émet un access token et un refresh token cookie.
 *
 * Sécurité — message d'erreur unifié :
 *   On retourne toujours INVALID_CREDENTIALS avec un 401, que l'email soit
 *   inexistant ou que le mot de passe soit incorrect.
 *   Cela empêche l'énumération d'utilisateurs (user enumeration attack).
 *
 * @param {string} email
 * @param {string} password
 */
async function loginCore({ email, password }) {
    try {
        const { check, userId, privilege } = await checkPasswordByEmail({ password, email });

        // Message identique dans les deux cas (email inconnu ou mot de passe incorrect)
        // pour ne pas révéler si le compte existe ou non.
        if (!check) {
            return json(401, { ok: false, message: "INVALID_CREDENTIALS" });
        }

        const accessTokenPayload = { userId, privilege };
        const accessToken = await signAccessTokenWithKms(accessTokenPayload);
        const refreshTokenCookie = await generateNewRefreshToken(userId, REFRESH_JWT_HMAC);

        return json(
            200,
            {
                ok: true,
                userId: userId,
                message: "LOGGED_IN",
                accessToken: accessToken,
            },
            [refreshTokenCookie],
        );

    } catch (err) {
        // AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH : email inexistant en base
        // → même message générique que mot de passe incorrect (anti-énumération)
        if (err?.message === "AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH") {
            return json(401, { ok: false, message: "INVALID_CREDENTIALS" });
        }
        console.error("[loginUser] Erreur dans loginCore :", err.message);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}
