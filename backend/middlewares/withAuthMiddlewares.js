import { getAccessPublicKey } from "../auth/getAccessPublicKeyFromSsm.js";
import { verifyAccessToken } from "../auth/verifyAccessToken.js";
import { json } from "../helpers/toolbox.js";

// Claims JWT attendus — doivent correspondre aux valeurs émises par signAccessTokenWithKms.js.
// Configurables via variables d'environnement pour faciliter les déploiements multi-environnements.
const EXPECTED_JWT_ISSUER   = process.env.JWT_ISSUER   || "site-asso/api";
const EXPECTED_JWT_AUDIENCE = process.env.JWT_AUDIENCE || "site-asso/frontend";

/**
 * Extrait le header Authorization de l'événement Lambda (insensible à la casse).
 * API Gateway peut transmettre les headers en minuscules ou avec majuscules.
 *
 * @param {Object} event - Événement Lambda
 * @returns {string} Valeur du header Authorization, ou chaîne vide
 */
function extractAuthorizationHeader(event) {
    const headers = event?.headers || {};
    return headers.authorization || headers.Authorization || "";
}

/**
 * Extrait le Bearer token depuis le header Authorization.
 * Retourne null si le format est invalide ou si le token est absent.
 *
 * @param {string} authorizationHeader - Valeur du header Authorization
 * @returns {string|null} Le token JWT brut, ou null
 */
function extractBearerToken(authorizationHeader) {
    if (!authorizationHeader || typeof authorizationHeader !== "string") {
        return null;
    }

    const BEARER_PREFIX = "Bearer ";

    if (!authorizationHeader.startsWith(BEARER_PREFIX)) {
        return null;
    }

    const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();

    return token.length > 0 ? token : null;
}

/**
 * Vérifie si l'utilisateur possède au moins un des rôles requis.
 * Si aucun rôle n'est requis (tableau vide ou absent), retourne true.
 *
 * @param {string[]} userPrivileges  - Privilèges de l'utilisateur (champ `privilege` du JWT)
 * @param {string[]} requiredRoles   - Rôles nécessaires pour accéder à la route
 * @returns {boolean}
 */
function userHasAtLeastOneRequiredRole(userPrivileges = [], requiredRoles = []) {
    if (!requiredRoles?.length) {
        return true;
    }

    const userPrivilegesSet = new Set(Array.isArray(userPrivileges) ? userPrivileges : []);

    return requiredRoles.some((role) => userPrivilegesSet.has(role));
}

/**
 * Middleware d'authentification JWT pour les handlers Lambda.
 *
 * Fonctionnement :
 *  1. Extrait le Bearer token du header Authorization
 *  2. Récupère la clé publique KMS depuis SSM (avec cache Lambda)
 *  3. Vérifie via jose : signature RS256, expiration (exp), issuer (iss), audience (aud)
 *  4. Vérifie que l'utilisateur possède les rôles requis (champ `privilege` du JWT)
 *  5. Transmet au handler : `auth` (userId, privilege) et `jwt` (payload complet)
 *
 * Le contexte `auth` transmis au handler contient :
 *  - `auth.userId`    : identifiant de l'utilisateur (extrait du JWT, sans préfixe "USER#")
 *  - `auth.privilege` : tableau des rôles (ex: ["USER"], ["ADMIN"])
 *
 * @param {Function} handler            - Handler Lambda à protéger
 * @param {Object}   opts
 * @param {string[]} opts.requiredRoles - Rôles requis pour accéder à la route (ex: ["USER"])
 */
export function withAuth(handler, opts = {}) {
    const { requiredRoles } = opts;

    return async (event, context) => {

        // --- Étape 1 : extraction du token depuis le header Authorization ---
        const authorizationHeader = extractAuthorizationHeader(event);
        const bearerToken         = extractBearerToken(authorizationHeader);

        if (!bearerToken) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: "MISSING_BEARER" });
        }

        // --- Étape 2 : récupération de la clé publique KMS (mise en cache par Lambda) ---
        let publicKey;
        try {
            publicKey = await getAccessPublicKey();
        } catch (keyFetchError) {
            console.error("[withAuth] Impossible de récupérer la clé publique depuis SSM :", keyFetchError.message);
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        // --- Étape 3 : vérification complète du token ---
        // jose.jwtVerify() contrôle : signature RS256, exp (expiration), iss (issuer), aud (audience)
        const verificationResult = await verifyAccessToken(bearerToken, publicKey, {
            issuer:   EXPECTED_JWT_ISSUER,
            audience: EXPECTED_JWT_AUDIENCE,
        });

        if (!verificationResult.ok) {
            return json(401, {
                ok:      false,
                message: "UNAUTHORIZED",
                code:    verificationResult.code,
            });
        }

        const jwtPayload = verificationResult.payload;

        // --- Étape 4 : vérification des rôles ---
        // Le champ `privilege` du JWT contient les rôles de l'utilisateur (ex: ["USER"]).
        // Ne pas confondre avec `payload.roles` qui n'existe pas dans le JWT de ce projet.
        const userPrivileges = jwtPayload.privilege;

        if (requiredRoles?.length && !userHasAtLeastOneRequiredRole(userPrivileges, requiredRoles)) {
            return json(403, { ok: false, message: "FORBIDDEN" });
        }

        // --- Étape 5 : construction du contexte auth transmis au handler ---
        const authContext = {
            userId:    jwtPayload.userId,
            privilege: Array.isArray(userPrivileges) ? userPrivileges : [],
        };

        return handler(event, context, { auth: authContext, jwt: { payload: jwtPayload } });
    };
}
