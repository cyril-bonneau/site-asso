import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION || "eu-west-3" });

export async function putToS3(params) {
    try {
        const command = new PutObjectCommand(params);
        return await s3.send(command);
    } catch (err) {
        console.error("S3 PUT ERROR:", err)
        throw err
    }
}