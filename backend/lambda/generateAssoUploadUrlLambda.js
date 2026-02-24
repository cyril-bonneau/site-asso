import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { json } from "../helpers/toolbox.js";
import { validateInput } from "../zod/validateInput.js";
import { preSignedUrlSchema } from "../zod/zodSchema/preSignedUrlValidation.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";

const s3 = new S3Client({ region: process.env.AWS_REGION || "eu-west-3" });

export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
})

async function handlerCore(event) {
    console.log("generateAssoUploadUrlLambda event:", event);
    let input;
    try {
        input = validateInput(event, preSignedUrlSchema);
        console.log("Validated input:", input);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }
    } catch (error) {
        console.error("Error in generateAssoUploadUrlLambda:", error);
        return json(500, { ok: false, message: "UNEXPECTED_ERROR_IN_VALIDATION" });
    }
    const { assoId, contentType, size, checksum } = input.body.data;

    const key = `ASSO#${assoId}/META/LOGO`;

    const params = {
        Bucket: process.env.ASSO_LOGO_BUCKET,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
        Metadata: {
            checksum: checksum,
            "original-filename": `${assoId}_logo`
        }
    };

    const command = new PutObjectCommand(params);

    try {
        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 120 });  // URL valable 2 minutes
        console.log("Generated pre-signed URL:", uploadUrl);
        return json(200, { ok: true, data: { uploadUrl } });
    } catch (error) {
        console.error("Error generating pre-signed URL:", error);
        return json(500, { ok: false, message: "ERROR_GENERATING_UPLOAD_URL" });
    }
}