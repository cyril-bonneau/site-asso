import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { unmarshall } from "@aws-sdk/util-dynamodb";

const USER_TABLE = process.env.USER_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const RETRYABLE = new Set([
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "InternalServerError",
    "RequestLimitExceeded",
    "LimitExceededException",
]);

// event must contain userId in pathParameters and fields to update in body 
// (if email is to be updated, use oldEmail and newEmail field)

export const handler = async (event) => {
    for (const rec of event.Records ?? []) {
        console.log(rec.eventName)
        try {
            if (rec.eventName !== "MODIFY") continue

            console.log("rec.dynamodb?.NewImage", rec.dynamodb?.OldImage)
            const newImgRaw = rec.dynamodb?.NewImage;
            const oldImgRaw = rec.dynamodb?.OldImage;

            if (!newImgRaw) continue;

            const userId = oldImg?.userId

            const oldImg = unmarshall(oldImgRaw)
            const newImg = unmarshall(newImgRaw)
            const oldEmail = oldImg?.email
            const newEmail = newImg?.email


            const data = {
                "oldImage": oldImg,
                "newImage": newImg
            }
            console.log("data", data)

            if (!userId || !oldEmail || !newEmail) {
                console.log("what is missing", userId, oldEmail, newEmail)
                throw err
            }

            console.log("updateUser oldImg", oldImg);
            console.log("updateUser newImg", newImg);

            return updateUser(data, userId);

        } catch (err) {
            console.error("Error in updateUser handler:", err);
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
        } // if newEmail is present then update email with uniqueness check else update other fields
    }
}

async function updateUser(data, userId) {

    const normalizedNewEmail = String(data.newImage?.newEmail).trim().toLowerCase();
    const lastName = data.newImage?.lastName || undefined
    const oldLastName = data.oldImage?.lastName || undefined
    const firstName = data.newImage?.firstName || undefined
    const oldFirstName = data.oldImage?.firstName || undefined

    const transaction = []

    transaction.push({
        Update: {
            TableName: USER_TABLE,
            Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
            UpdateExpression: `SET #email = :email, #GSI1SK = :GSI1SK, #firstName = firstName, #lastName = lastName, #updatedAt = :updatedAt`,
            ExpressionAttributeNames: {
                "#email": "email",
                "#GSI1SK": "GSI1SK",
                "#firstName": "firstName",
                "#lastName": "lastName",
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":email": normalizedNewEmail,
                ":GSI1SK": normalizedNewEmail,
                ":firstName": firstName,
                ":lastName": lastName,
                ":updatedAt": new Date().toISOString(),
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    })

    transaction.push({
        Delete: {
            TableName: USER_TABLE,
            Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
        }
    })

    transaction.push({
        Put: {
            TableName: USER_TABLE,
            Item: {
                PK: `EMAIL#${normalizedNewEmail}`,
                SK: "UNIQUE",
                userId: userId,
                GSI1SK: normalizedNewEmail,
                createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    })

    try {

        console.log("Executing transaction:", transaction);
        const resultUpdateUser = await ddb.send(new TransactWriteCommand({
            TranscationItems: transaction,
            ReturnConsumedCapacity: "TOTAL",
        }));

        return json(200, { ok: true, message: "Updated successfully", resultUpdateUser });

    } catch (err) {

        const errorName = err?.name || "";
        const msg = err?.message || "";

        return json(err.statusCode, { ok: false, error_name: errorName, message: msg });

    }
}

async function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}