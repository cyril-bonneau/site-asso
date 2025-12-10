// backend/scripts/syncKmsPublicKeyToSsm.mjs
import { KMSClient, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { SSMClient, PutParameterCommand } from "@aws-sdk/client-ssm";

const region = process.env.AWS_REGION || "eu-west-3";
const stage = process.env.STAGE;

if (!stage) {
    console.error("Missing STAGE env. Aborting.");
    process.exit(1);
}

const kmsKeyId = `alias/site-asso-auth-${stage}`;
const ssmParamName = `/site-asso/${stage}/cfg/jwtAccessPub`;

const kms = new KMSClient({ region });
const ssm = new SSMClient({ region });

function derToPem(derBuffer) {
    const base64 = Buffer.from(derBuffer).toString("base64");
    const lines = base64.match(/.{1,64}/g) || [];
    return [
        "-----BEGIN PUBLIC KEY-----",
        ...lines,
        "-----END PUBLIC KEY-----",
        ""
    ].join("\n");
}

async function main() {
    try {
        console.log(`Fetching public key from KMS (${kmsKeyId}) in ${region} ...`);

        const res = await kms.send(
            new GetPublicKeyCommand({
                KeyId: kmsKeyId
            })
        );

        if (!res.PublicKey) {
            throw new Error("KMS returned no PublicKey");
        }

        const pem = derToPem(res.PublicKey);
        console.log("Public key fetched and converted to PEM.");

        console.log(
            `Storing public key into SSM parameter "${ssmParamName}" (Overwrite = true)...`
        );

        await ssm.send(
            new PutParameterCommand({
                Name: ssmParamName,
                Type: "String",
                Value: pem,
                Overwrite: true
            })
        );

        console.log("KMS public key successfully stored in SSM.");
    } catch (err) {
        console.error("Error while syncing KMS public key to SSM:", err);
        process.exit(1);
    }
}

main();
