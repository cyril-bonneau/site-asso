import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { toBase64Url } from "../helpers/toolbox.js";

const region = process.env.AWS_REGION || "eu-west-3";
const keyId = process.env.KMS_JWT_KEY_ID;

const kms = new KMSClient({ region });

export async function signAccessTokenWithKms(payload = {}, options = {}) {

    const { expiresIn = 15 * 60, issuer = "site-asso/api", audience = "site-asso/frontend" } = options;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + expiresIn;

    const header = {
        alg: "RS256",
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

    const signRes = await kms.send(
        new SignCommand({
            KeyId: keyId,
            Message: dataToSign,
            MessageType: "RAW",
            SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
        })
    );

    if (!signRes.Signature) {
        throw new Error("KMS_SIGNING_FAILED");
    }
    const signatureB64 = toBase64Url(signRes.Signature);
    return `${dataToSign}.${signatureB64}`;
}