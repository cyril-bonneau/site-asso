import { unmarshall } from "@aws-sdk/util-dynamodb";
import { sendTransactToDb } from "../dal/requestToDb.js";

const USER_TABLE = process.env.USER_TABLE;

const RETRYABLE = new Set([
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "InternalServerError",
    "RequestLimitExceeded",
    "LimitExceededException",
]);

export const handler = async (event) => {
    for (const rec of event.Records ?? []) {
        console.log(rec.eventName)
        try {
            if (rec.eventName !== "REMOVE") continue

            const oldImgRaw = rec.dynamodb?.OldImage;
            console.log("rec.dynamodb?.OldImage", oldImgRaw)

            if (!oldImgRaw) continue;

            const oldImg = unmarshall(oldImgRaw);
            const email = oldImg.email;
            const userId = oldImg.userId;

            if (!email || !userId) {
                console.warn("onAuthStream: record incomplet (skip)", { hasEmail: !!email });
                continue;
            }

            await removeUserWithUniqueEmail({ userId, email })

        } catch (err) {
            if (err?.name === "ConditionalCheckFailedException") {
                console.info("onAuthStream: déjà présent (idempotent), on continue");
                continue;
            }

            if (RETRYABLE.has(err?.name)) {
                console.warn("onAuthStream: erreur réessayable → retry ESM", { name: err?.name });
                throw err;
            }

            console.error("onAuthStream: erreur non-idempotente", { name: err?.name, message: err?.message });
            throw err;
        }
    }
}

async function removeUserWithUniqueEmail({ userId, email }) {

    const pkEmail = `EMAIL#${email}`
    const skEmail = "UNIQUE"
    const pkUser = `USER#${userId}`
    const skUser = `PROFILE#${userId}`

    console.log("userId and skuser = ", userId, skUser)

    const removeRequest = [
        {
            Delete: {
                TableName: USER_TABLE,
                Key: { PK: pkUser, SK: skUser },
                ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            }
        },
        {
            Delete: {
                TableName: USER_TABLE,
                Key: { PK: pkEmail, SK: skEmail },
                ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            }
        }
    ]

    try {
        await sendTransactToDb(removeRequest)
    } catch (err) {
        console.log("wtf", err)
        if (err?.name === "ConditionalCheckFailedException") {
            console.warn("onAuthStream: inexistant, continue");
        }
    }
    console.info("onRemoveAuthStream: projection OK");
}