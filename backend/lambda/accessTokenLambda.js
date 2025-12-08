import { signAccessToken } from "../dal/requestToKms";
import { toBase64Url, json } from "../helpers/toolbox.js";

export async function handler(event) {
    try {
        let data;
        try {
            data = JSON.parse(event.body);
        } catch (err) {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" })
        }

        const accessToken = await signAccessTokenWithKms(data.payload);
        console.info("Generated access token via KMS");
        return json(201, { ok: true, accessToken });
    } catch (err) {
        console.error("Fatal error in access token handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function signAccessTokenWithKms(payload = {}, options = {}) {

    const { expiresIn = 15 * 60, issuer = "site-asso/api", audience = "site-asso/frontend" } = options;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresIn;

    const header = {
        alg: "PS256",
        typ: "JWT"
    }

    const payloadFinal = {
        issuedAt: now,
        expiresAt: exp,
        issuer: issuer,
        audience: audience,
        ...payload,
    }

    const headerB64 = toBase64Url(Buffer.from(JSON.stringify(header)));
    const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payloadFinal)));
    const dataToSign = Buffer.from(`${headerB64}.${payloadB64}`);

    const signRes = await signAccessToken(dataToSign);

    if (!signRes.Signature) {
        throw new Error("KMS_SIGNING_FAILED");
    }
    const signatureB64 = toBase64Url(signRes.Signature);
    return `${dataToSign}.${signatureB64}`;
}