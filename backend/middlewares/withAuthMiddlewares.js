import { getAccessPublicKey } from "../auth/getAccessPublicKeyFromSsm.js";
import { verifyAccessToken } from "../auth/verifyAccessToken.js";
import { json } from "../helpers/toolbox.js";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// Claims JWT attendus — doivent correspondre aux valeurs émises par signAccessTokenWithKms.js.
// Configurables via variables d'environnement pour les déploiements multi-environnements.
const EXPECTED_JWT_ISSUER   = process.env.JWT_ISSUER   || "site-asso/api";
const EXPECTED_JWT_AUDIENCE = process.env.JWT_AUDIENCE || "site-asso/frontend";

// Statuts possibles retournés par authenticateRequest()
const AUTH_STATUS = {
    AUTHENTICATED: "authenticated",  // Token présent et valide
    NO_TOKEN:      "no_token",       // Aucun token dans la requête
    INVALID_TOKEN: "invalid_token",  // Token présent mais invalide ou expiré
    SERVER_ERROR:  "server_error",   // Erreur interne (ex: SSM inaccessible)
};

// ─────────────────────────────────────────────────────────────────────────────
// Fonctions utilitaires (usage interne uniquement)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extrait la valeur du header Authorization depuis l'événement Lambda.
 * Insensible à la casse car API Gateway peut transmettre les headers en
 * minuscules ou avec une majuscule selon la configuration.
 *
 * @param {Object} event - Événement Lambda (API Gateway)
 * @returns {string} Valeur du header Authorization, ou chaîne vide si absent
 */
function extractAuthorizationHeader(event) {
    const headers = event?.headers || {};
    return headers.authorization || headers.Authorization || "";
}

/**
 * Extrait le token JWT brut depuis un header Authorization de type Bearer.
 * Retourne null si le header est absent, mal formaté, ou si le token est vide.
 *
 * Format attendu : "Bearer <token>"
 *
 * @param {string} authorizationHeader - Valeur brute du header Authorization
 * @returns {string|null} Le token JWT, ou null
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
 * Vérifie si l'utilisateur possède au moins un des rôles requis pour accéder à la route.
 * Si aucun rôle n'est requis (tableau vide ou absent), l'accès est accordé par défaut.
 *
 * Utilise un Set pour la recherche en O(1).
 *
 * @param {string[]} userPrivileges  - Rôles de l'utilisateur (champ `privilege` du JWT)
 * @param {string[]} requiredRoles   - Rôles nécessaires pour accéder à la route
 * @returns {boolean}
 */
function userHasAtLeastOneRequiredRole(userPrivileges = [], requiredRoles = []) {
    if (!requiredRoles || requiredRoles.length === 0) {
        return true;
    }

    const userPrivilegesSet = new Set(Array.isArray(userPrivileges) ? userPrivileges : []);

    return requiredRoles.some((role) => userPrivilegesSet.has(role));
}

/**
 * Construit le contexte `auth` transmis aux handlers.
 *
 * Ce contexte est la seule source de vérité sur l'identité de l'utilisateur
 * dans un handler. Il est construit à partir du payload JWT vérifié.
 *
 * @param {Object} jwtPayload - Payload du JWT décodé et vérifié
 * @returns {{ userId: string, privilege: string[] }}
 */
function buildAuthContext(jwtPayload) {
    return {
        userId:    jwtPayload.userId,
        privilege: Array.isArray(jwtPayload.privilege) ? jwtPayload.privilege : [],
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fonction principale partagée : authentification d'une requête
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tente d'authentifier une requête Lambda à partir du Bearer token.
 *
 * Cette fonction centralise toute la logique d'authentification et retourne
 * un objet structuré décrivant le résultat. Elle est utilisée par `withAuth`
 * et `withOptionalAuth` qui décident ensuite quoi faire selon le statut.
 *
 * Résultats possibles (via AUTH_STATUS) :
 *  - AUTHENTICATED  : token présent, signature valide, exp/iss/aud corrects
 *                     → { status, authContext, jwtPayload }
 *  - NO_TOKEN       : aucun Bearer token dans les headers
 *                     → { status }
 *  - INVALID_TOKEN  : token présent mais invalide, expiré ou claims incorrects
 *                     → { status, errorCode }
 *  - SERVER_ERROR   : impossible de récupérer la clé publique (SSM indisponible)
 *                     → { status }
 *
 * @param {Object} event - Événement Lambda
 * @returns {Promise<Object>} Résultat de l'authentification
 */
async function authenticateRequest(event) {

    // Étape 1 : extraction du token depuis le header Authorization
    const authorizationHeader = extractAuthorizationHeader(event);
    const bearerToken         = extractBearerToken(authorizationHeader);

    if (!bearerToken) {
        return { status: AUTH_STATUS.NO_TOKEN };
    }

    // Étape 2 : récupération de la clé publique KMS (mise en cache entre les invocations Lambda)
    let publicKey;
    try {
        publicKey = await getAccessPublicKey();
    } catch (ssmError) {
        console.error("[withAuth] Impossible de récupérer la clé publique depuis SSM :", ssmError.message);
        return { status: AUTH_STATUS.SERVER_ERROR };
    }

    // Étape 3 : vérification complète du token par jose
    // jose.jwtVerify() vérifie automatiquement : signature RS256, exp, iss, aud
    const verificationResult = await verifyAccessToken(bearerToken, publicKey, {
        issuer:   EXPECTED_JWT_ISSUER,
        audience: EXPECTED_JWT_AUDIENCE,
    });

    if (!verificationResult.ok) {
        return {
            status:    AUTH_STATUS.INVALID_TOKEN,
            errorCode: verificationResult.code,
        };
    }

    // Étape 4 : construction du contexte auth à partir du payload vérifié
    const jwtPayload  = verificationResult.payload;
    const authContext = buildAuthContext(jwtPayload);

    return {
        status:      AUTH_STATUS.AUTHENTICATED,
        authContext: authContext,
        jwtPayload:  jwtPayload,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Middlewares exportés
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Middleware d'authentification JWT stricte pour les handlers Lambda.
 *
 * La requête est bloquée si :
 *  - Aucun Bearer token n'est présent → 401 MISSING_BEARER
 *  - Le token est invalide ou expiré  → 401 (code détaillé)
 *  - L'utilisateur n'a pas les rôles requis → 403 FORBIDDEN
 *
 * Si tout est valide, le handler est appelé avec :
 *  - `auth.userId`    : identifiant de l'utilisateur (sans préfixe "USER#")
 *  - `auth.privilege` : tableau des rôles de l'utilisateur (ex: ["USER"])
 *  - `jwt.payload`    : payload JWT complet (pour accès aux claims supplémentaires)
 *
 * Usage :
 *  export const handler = withAuth(handlerCore, { requiredRoles: ["USER"] });
 *
 * @param {Function} handler            - Handler Lambda à protéger
 * @param {Object}   opts
 * @param {string[]} opts.requiredRoles - Rôles requis (ex: ["USER"], ["ADMIN"])
 */
export function withAuth(handler, opts = {}) {
    const { requiredRoles } = opts;

    return async (event, context) => {

        const authResult = await authenticateRequest(event);

        if (authResult.status === AUTH_STATUS.SERVER_ERROR) {
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        if (authResult.status === AUTH_STATUS.NO_TOKEN) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: "MISSING_BEARER" });
        }

        if (authResult.status === AUTH_STATUS.INVALID_TOKEN) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: authResult.errorCode });
        }

        // Ici authResult.status === AUTH_STATUS.AUTHENTICATED
        const { authContext, jwtPayload } = authResult;

        // Vérification des rôles requis pour cette route
        const userCanAccessThisRoute = userHasAtLeastOneRequiredRole(authContext.privilege, requiredRoles);
        if (!userCanAccessThisRoute) {
            return json(403, { ok: false, message: "FORBIDDEN" });
        }

        return handler(event, context, { auth: authContext, jwt: { payload: jwtPayload } });
    };
}

/**
 * Middleware d'authentification optionnelle JWT pour les handlers Lambda.
 *
 * Contrairement à `withAuth`, ce middleware ne bloque pas les requêtes sans token.
 * Il est conçu pour les routes publiques qui adaptent leur réponse selon que
 * l'utilisateur est connecté ou non (ex : /login, pages avec contenu personnalisé).
 *
 * Comportement selon les cas :
 *  - Pas de token           → handler appelé avec auth: null (utilisateur anonyme)
 *  - Token valide           → handler appelé avec le contexte auth complet
 *  - Token invalide/expiré  → 401 (si un token est fourni, il doit être valide)
 *
 * Dans le handler, toujours vérifier si `auth` est null avant de l'utiliser :
 *
 *  async function handlerCore(event, context, { auth }) {
 *      if (auth !== null) {
 *          // Utilisateur authentifié → accès à auth.userId, auth.privilege
 *      } else {
 *          // Utilisateur anonyme
 *      }
 *  }
 *
 * Usage :
 *  export const handler = withOptionalAuth(handlerCore);
 *
 * @param {Function} handler - Handler Lambda
 */
export function withOptionalAuth(handler) {

    return async (event, context) => {

        const authResult = await authenticateRequest(event);

        if (authResult.status === AUTH_STATUS.SERVER_ERROR) {
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        if (authResult.status === AUTH_STATUS.NO_TOKEN) {
            // Pas de token → requête anonyme autorisée, auth est null
            return handler(event, context, { auth: null, jwt: null });
        }

        if (authResult.status === AUTH_STATUS.INVALID_TOKEN) {
            // Token fourni mais invalide → on bloque (ne pas ignorer silencieusement un token corrompu)
            return json(401, { ok: false, message: "UNAUTHORIZED", code: authResult.errorCode });
        }

        // Ici authResult.status === AUTH_STATUS.AUTHENTICATED
        const { authContext, jwtPayload } = authResult;

        return handler(event, context, { auth: authContext, jwt: { payload: jwtPayload } });
    };
}
