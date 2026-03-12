import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { toBase64Url } from "../helpers/toolbox.js";

const region = process.env.AWS_REGION    || "eu-west-3";
const keyId  = process.env.KMS_JWT_KEY_ID;

// Algorithme KMS correspondant à RS256 (RSASSA PKCS1 v1.5 + SHA-256)
const KMS_SIGNING_ALGORITHM = "RSASSA_PKCS1_V1_5_SHA_256";

// Durée de validité par défaut de l'access token : 15 minutes
const DEFAULT_EXPIRES_IN_SECONDS = 15 * 60;

// Valeurs par défaut pour les claims standard iss/aud.
// Ces valeurs DOIVENT correspondre à EXPECTED_JWT_ISSUER / EXPECTED_JWT_AUDIENCE dans withAuthMiddlewares.js.
const DEFAULT_ISSUER   = process.env.JWT_ISSUER   || "site-asso/api";
const DEFAULT_AUDIENCE = process.env.JWT_AUDIENCE || "site-asso/frontend";

const kmsClient = new KMSClient({ region });

/**
 * Signe un access token JWT via AWS KMS (algorithme RS256).
 *
 * La clé privée ne quitte jamais AWS KMS — seule la signature est retournée.
 *
 * IMPORTANT — Claims JWT standards obligatoires (RFC 7519) :
 *   - `iat`  : date d'émission en secondes Unix (issued at)
 *   - `exp`  : date d'expiration en secondes Unix — vérifié AUTOMATIQUEMENT par jose.jwtVerify()
 *   - `iss`  : émetteur du token (issuer)
 *   - `aud`  : audience cible du token
 *
 *   Ces noms DOIVENT rester standards pour que jwtVerify() les valide automatiquement.
 *   Ne PAS les renommer en issuedAt / expiresAt / issuer / audience (noms non reconnus par jose).
 *
 * @param {Object} payload             - Données métier à inclure (userId, privilege, etc.)
 * @param {Object} [options]
 * @param {number} [options.expiresIn] - Durée de validité en secondes (défaut : 15 min)
 * @param {string} [options.issuer]    - Valeur du claim `iss`
 * @param {string} [options.audience]  - Valeur du claim `aud`
 * @returns {Promise<string>}          - Token JWT signé au format "header.payload.signature"
 */
export async function signAccessTokenWithKms(payload = {}, options = {}) {

    const {
        expiresIn = DEFAULT_EXPIRES_IN_SECONDS,
        issuer    = DEFAULT_ISSUER,
        audience  = DEFAULT_AUDIENCE,
    } = options;

    const nowSeconds       = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + expiresIn;

    // En-tête JWT standard
    const jwtHeader = {
        alg: "RS256",
        typ: "JWT",
    };

    // Payload JWT avec claims standards IETF RFC 7519.
    // `exp` est lu automatiquement par jose.jwtVerify() pour valider l'expiration.
    // `iss` et `aud` sont validés si les options correspondantes sont passées à jwtVerify().
    const jwtPayload = {
        iat: nowSeconds,        // issued at     — RFC 7519 §4.1.6
        exp: expiresAtSeconds,  // expiration    — RFC 7519 §4.1.4 — vérifié par jwtVerify()
        iss: issuer,            // issuer        — RFC 7519 §4.1.1
        aud: audience,          // audience      — RFC 7519 §4.1.3
        ...payload,             // données métier (userId, privilege, etc.)
    };

    // Encodage base64url de l'en-tête et du payload
    const encodedHeader  = toBase64Url(Buffer.from(JSON.stringify(jwtHeader)));
    const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(jwtPayload)));

    // Données à signer : "<header_b64>.<payload_b64>"
    const dataToSign = Buffer.from(`${encodedHeader}.${encodedPayload}`);

    // Appel KMS pour signer — la clé privée reste dans AWS KMS
    const kmsSignResponse = await kmsClient.send(
        new SignCommand({
            KeyId:            keyId,
            Message:          dataToSign,
            MessageType:      "RAW",
            SigningAlgorithm: KMS_SIGNING_ALGORITHM,
        })
    );

    if (!kmsSignResponse.Signature) {
        throw new Error("KMS_SIGNING_FAILED");
    }

    const encodedSignature = toBase64Url(kmsSignResponse.Signature);

    // Token JWT final : "<header>.<payload>.<signature>"
    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}
