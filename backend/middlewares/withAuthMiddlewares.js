import { getAccessPublicKey } from "../auth/getAccessPublicKeyFromSsm.js";
import { verifyAccessToken } from "../auth/verifyAccessToken.js";
import { json } from "../helpers/toolbox.js";

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

        console.info("Authorization header:", authorization);
        console.info("Extracted token:", token)
        if (!token) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: "MISSING_BEARER" });
        }

        let publicKey;
        try {
            publicKey = await getAccessPublicKey();
            console.log("publicKey", publicKey);
        } catch (err) {
            console.error("Error fetching public key:", err);
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        console.log("public key", publicKey);
        console.log("Verifying token:", token);
        const verified = await verifyAccessToken(token, publicKey, { issuer, audience });
        console.info("Verified token:", verified);

        if (!verified.ok) {
            return json(401, { ok: false, message: "UNAUTHORIZED", code: verified.code });
        }

        const { payload } = verified;

        console.log("Token payload after verification:", payload);
        console.log("Required roles:", requiredRoles);

        // roles optionnels
        if (requiredRoles?.length && !hasAnyRole(payload.privilege, requiredRoles)) {
            return json(403, { ok: false, message: "FORBIDDEN" });
        }

        const auth = {
            userId: payload.userId,
            roles: Array.isArray(payload.roles) ? payload.roles : [],
        };

        return handler(event, context, { auth, jwt: { payload } });
    };
}
