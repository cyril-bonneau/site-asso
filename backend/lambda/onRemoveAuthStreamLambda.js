import { DynamoDBClient, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const USER_TABLE = process.env.USER_TABLE;
const ddb = new DynamoDBClient({})

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

            console.log("rec.dynamodb?.NewImage", rec.dynamodb?.OldImage)
            const oldImgRaw = rec.dynamodb?.OldImage;

            if (!oldImgRaw) continue;

            const oldImg = unmarshall(oldImgRaw);
            const email = oldImg.email
            const userId = oldImg.userId

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

    try {
        console.log("je passe ici")
        await ddb.send(
            new DeleteItemCommand({
                TableName: USER_TABLE,
                Key: marshall({
                    PK: pkEmail,
                    SK: skEmail
                }),
                ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            })
        )
    } catch (err) {
        console.log("wtf", err)
        if (err?.name === "ConditionalCheckFailedException") {
            console.warn("onAuthStream: inexistant, continue");
        }
    }

    try {
        console.log("je rentre ici aussi")
        await ddb.send(
            new DeleteItemCommand({
                TableName: USER_TABLE,
                Key: marshall({
                    PK: pkUser,
                    SK: skUser
                }),
                ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            }))
    } catch (err) {
        console.log("mais putain !", err)
        if (err?.name === "ConditionalCheckFailedException") {
            console.warn("onAuthStream: déjà présent (idempotent), on continue");
            return;
        }
        throw err; // retryables ou inconnues
    }

    console.info("onRemoveAuthStream: projection OK");
}