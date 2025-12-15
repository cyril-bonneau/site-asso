import { getAccessPublicKey } from "../auth/getAccessPublicKeyFromSsm.js";
import { verifyAccessToken } from "../auth/verifyAccessToken.js";
import { json } from "../helpers/json.js";

function getAuthHeader(event) {
    const h = event?.headers || {};
    return h.authorization || h.Authorization || "";
}

function extractBearerToken(authorization) {
    if (!authorization || typeof authorization !== "string") return null;
    const prefix = "Bearer ";
    if (!authorization.startsWith(prefix)) return null;
    const token = authorization.slice(prefix.length).trim();
    return token.length ? token : null;
}

function hasAnyRole(userRoles = [], requiredRoles = []) {
    if (!requiredRoles?.length) return true;
    const set = new Set(Array.isArray(userRoles) ? userRoles : []);
    return requiredRoles.some((r) => set.has(r));
}

export function withAuth(handler, opts = {}) {
    const {
        issuer,
        audience,
        requiredRoles,
    } = opts;

    return async (event, context) => {
        const authorization = getAuthHeader(event);
        const token = extractBearerToken(authorization);

        if (!token) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: "MISSING_BEARER" });
        }

        let publicKey;
        try {
            publicKey = await getAccessPublicKey();
        } catch (e) {
            // Ne leak pas les détails
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        const verified = await verifyAccessToken(token, publicKey, { issuer, audience });

        if (!verified.ok) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: verified.code });
        }

        const { payload } = verified;

        // roles optionnels
        if (requiredRoles?.length && !hasAnyRole(payload.roles, requiredRoles)) {
            return json(403, { ok: false, message: "FORBIDDEN" });
        }

        const auth = {
            userId: payload.userId,
            roles: Array.isArray(payload.roles) ? payload.roles : [],
            // Tu peux rajouter email / globalRoles / assoRoles plus tard
        };

        // On passe auth en 3e param (propre, pas dépendant d’API Gateway)
        return handler(event, context, { auth, jwt: { payload } });
    };
}
