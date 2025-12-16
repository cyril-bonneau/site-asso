import { jwtVerify } from "jose";

function mapJoseError(err) {
    const name = err?.name || "JOSEError";

    if (name === "JWTExpired") return { code: "TOKEN_EXPIRED" };
    if (name === "JWTInvalid") return { code: "TOKEN_INVALID" };
    if (name === "JWTClaimValidationFailed") return { code: "TOKEN_CLAIMS_INVALID" };

    return { code: "TOKEN_INVALID" };
}

export async function verifyAccessToken(token, publicKey, opts = {}) {
    try {
        const { issuer, audience } = opts;

        console.log("Verifying token with options:", { issuer, audience });

        const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
            algorithms: ["PS256"],
            issuer: issuer || undefined,
            audience: audience || undefined,
        });

        console.log("Token payload:", payload);
        console.log("Token protectedHeader:", protectedHeader);

        if (!payload?.userId || typeof payload.userId !== "string") {
            return { ok: false, code: "TOKEN_PAYLOAD_INVALID" };
        }

        return { ok: true, payload, protectedHeader };
    } catch (err) {
        console.log("Error verifying token:", err);
        return { ok: false, ...mapJoseError(err) };
    }
}
