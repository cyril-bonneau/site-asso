import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const USER_TABLE = process.env.USER_TABLE;
const ddb = new DynamoDBClient({});

const isoNow = () => new Date().toISOString();

const RETRYABLE = new Set([
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "InternalServerError",
    "RequestLimitExceeded",
    "LimitExceededException",
]);

// ----- handler de stream -----
export const handler = async (event) => {
    for (const rec of event.Records ?? []) {
        try {
            if (rec.eventName !== "INSERT") continue;

            const newImgRaw = rec.dynamodb?.NewImage;

            if (!newImgRaw) continue;

            const newImg = unmarshall(newImgRaw);
            const userId = newImg.userId;
            const email = newImg.email?.trim().toLowerCase() ?? undefined;
            const firstName = newImg.firstName ?? undefined;
            const lastName = newImg.lastName ?? undefined;

            if (!email || !userId) {
                console.warn("onAuthStream: record incomplet (skip)", { hasEmail: !!email, hasUserId: !!userId });
                continue;
            }

            await createUserWithUniqueEmail({ email, firstName, lastName, userId });

        } catch (err) {
            if (err?.name === "ConditionalCheckFailedException") {
                console.info("onAuthStream: déjà présent (idempotent), on continue");
                continue;
            }

            // Erreurs réessayables → on *throw* pour que l'ESM retry/bisect/DLQ fasse son job
            if (RETRYABLE.has(err?.name)) {
                console.warn("onAuthStream: erreur réessayable → retry ESM", { name: err?.name });
                throw err;
            }

            // Autres erreurs : on log et on *throw* (ira en DLQ après quelques retries ESM)
            console.error("onAuthStream: erreur non-idempotente", { name: err?.name, message: err?.message });
            throw err;
        }
    }
};

async function createUserWithUniqueEmail({ email, firstName = undefined, lastName = undefined, userId } = {}) {
    const now = isoNow();

    const emailLockItem = {
        PK: `EMAIL#${email}`,
        SK: "UNIQUE",
        userId: userId,
        createdAt: now,
    };

    const userItem = {
        PK: `USER#${userId}`,
        SK: `PROFILE#${userId}`,
        GSI1PK: 'USER#EMAIL',
        GSI1SK: email,
        userId: userId,
        email: email,
        firstName: firstName,
        lastName: lastName,
        createdAt: now,
        updatedAt: now,
    };

    try {
        await ddb.send(new PutItemCommand({
            TableName: USER_TABLE,
            Item: marshall(emailLockItem, { removeUndefinedValues: true }),
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        }))
    } catch (err) {
        if (err?.name === "ConditionalCheckFailedException") {
            console.warn("onAuthStream: déjà présent (idempotent), on continue");
        }
    }

    try {
        await ddb.send(new PutItemCommand({
            TableName: USER_TABLE,
            Item: marshall(userItem, { removeUndefinedValues: true }),
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
        }))
    } catch (err) {
        if (err?.name === "ConditionalCheckFailedException") {
            console.warn("onAuthStream: déjà présent (idempotent), on continue");
            return;
        }
        throw err; // retryables ou inconnues
    }

    // Succès : les 2 Put sont passés
    console.info("onAuthStream: projection OK", { userId, email });
}
