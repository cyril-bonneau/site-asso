import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json } from "../helpers/toolbox.js";
import { validateInput } from "../zod/validateInput.js";
import { preSignedUrlSchema } from "../zod/zodSchema/preSignedUrlValidation.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";
import { z } from "zod";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-3" });

// Durée de validité de l'URL présignée S3 : 2 minutes
const PRESIGNED_URL_EXPIRY_SECONDS = 120;

// Schéma de validation pour l'assoId reçu en query parameter.
// nanoid() génère des identifiants de 21 caractères avec l'alphabet A-Za-z0-9_-
const assoIdSchema = z
    .string()
    .min(5)
    .max(50)
    .regex(/^[A-Za-z0-9_-]+$/, "assoId contient des caractères non autorisés");

/**
 * Handler protégé : génère une URL présignée S3 pour uploader le logo d'une association.
 *
 * Sécurité :
 *   - Requiert un access token JWT valide (via withAuth)
 *   - L'assoId est validé en format avant utilisation dans la clé S3
 *   - Le Content-Type est limité à image/png (whitelist stricte dans preSignedUrlSchema)
 *
 * TODO — Vérification d'ownership (priorité haute) :
 *   Actuellement, tout utilisateur authentifié peut générer une URL pour n'importe quelle
 *   association. Une fois le modèle de membership implémenté (table MEMBER#userId/ASSO#assoId),
 *   ajouter ici la vérification que auth.userId est bien admin de l'association assoId.
 */
export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
});

/**
 * Corps du handler : valide les entrées et génère l'URL présignée S3.
 *
 * @param {Object} event   - Événement Lambda
 * @param {Object} _context - Contexte Lambda (non utilisé)
 * @param {Object} param2  - Contexte auth injecté par withAuth
 * @param {Object} param2.auth - { userId: string, privilege: string[] }
 */
async function handlerCore(event, _context, { auth }) {

    // --- Validation du body (contentType, size, checksum, fileName) ---
    let validatedInput;
    try {
        validatedInput = validateInput(event, preSignedUrlSchema);

        if (!validatedInput.ok) {
            return json(validatedInput.statusCode, {
                ok:      false,
                message: validatedInput.body.message,
            });
        }
    } catch (error) {
        console.error("[generateAssoUploadUrl] Erreur lors de la validation du body :", error.message);
        return json(500, { ok: false, message: "UNEXPECTED_ERROR_IN_VALIDATION" });
    }

    // --- Validation et assainissement de l'assoId ---
    // L'assoId vient des query params — il est utilisé dans la clé S3, donc doit être validé
    // strictement pour éviter tout chemin inattendu dans le bucket.
    const rawAssoId       = event.queryStringParameters?.assoId;
    const assoIdParseResult = assoIdSchema.safeParse(rawAssoId);

    if (!assoIdParseResult.success) {
        console.warn("[generateAssoUploadUrl] assoId invalide :", rawAssoId);
        return json(400, { ok: false, message: "INVALID_ASSO_ID" });
    }

    const assoId = assoIdParseResult.data;

    // Log d'audit (userId + assoId ciblé, sans données sensibles)
    console.info("[generateAssoUploadUrl] Génération d'URL présignée", {
        userId: auth.userId,
        assoId: assoId,
    });

    // --- Construction de la commande S3 ---
    const { contentType, size, checksum, fileName } = validatedInput.body.data;

    // Clé S3 fixe pour le logo d'une association — format attendu : ASSO#<id>/META/LOGO
    const s3ObjectKey = `ASSO#${assoId}/META/LOGO`;

    const s3PutCommand = new PutObjectCommand({
        Bucket:        process.env.ASSO_LOGO_BUCKET,
        Key:           s3ObjectKey,
        ContentType:   contentType,
        ContentLength: size,
        Metadata: {
            checksum:            checksum  || "",
            "original-filename": fileName  || "",
            "uploaded-by":       auth.userId,   // traçabilité de l'uploader
            "asso-id":           assoId,
        },
    });

    // --- Génération de l'URL présignée ---
    try {
        const presignedUploadUrl = await getSignedUrl(s3Client, s3PutCommand, {
            expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
        });

        return json(200, { ok: true, data: { uploadUrl: presignedUploadUrl } });

    } catch (error) {
        console.error("[generateAssoUploadUrl] Erreur lors de la génération de l'URL présignée :", error.message);
        return json(500, { ok: false, message: "ERROR_GENERATING_UPLOAD_URL" });
    }
}
