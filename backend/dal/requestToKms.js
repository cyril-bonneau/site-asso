import { KMSClient, SignCommand } from "@aws-sdk/client-kms";

const region = process.env.AWS_REGION || "eu-west-3";
const keyId = process.env.KMS_JWT_KEY_ID;
const kms = new KMSClient({ region });

export async function signAccessToken(dataToSign) {
    const signRes = await kms.send(
        new SignCommand({
            KeyId: keyId,
            Message: dataToSign,
            MessageType: "RAW",
            SigningAlgorithm: "RSASSA_PSS_SHA_256",
        })
    );
    return signRes;
}