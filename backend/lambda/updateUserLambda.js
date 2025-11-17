import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { buildDynUpdate } from "../helpers/updateUser.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

// event must contain userId in pathParameters and fields to update in body 
// (if email is to be updated, use oldEmail and newEmail field)

export const handler = async (event) => {
    try {
        const data = JSON.parse(event.body);
        const id = event?.queryStringParameters?.id;
        console.log("updateUser handler data:", data);
        if (!event?.queryStringParameters?.id) {
            return json(400, { error: "MISSING_USER_ID" });
        }

        return updateUser(data, id);
    } catch (err) {
        console.error("Error in updateUser handler:", err);
        return {
            statusCode: err.statusCode || 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    } // if newEmail is present then update email with uniqueness check else update other fields
}

async function updateUser(data, id) {

    const oldEmail = data?.oldEmail;
    const normalizedNewEmail = String(data?.newEmail).trim().toLowerCase();

    const transaction = []

    transaction.push({
        Update: {
            TableName: AUTH_TABLE,
            Key: { PK: `USER#${id}`, SK: "AUTH" },
            UpdateExpression: `SET #email = :email, #GSI1PK = :GSI1PK, #updatedAt = :updatedAt`,
            ExpressionAttributeNames: {
                "#email": "email",
                "#GSI1PK": "GSI1PK",
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":email": normalizedNewEmail,
                ":GSI1PK": `EMAIL#${normalizedNewEmail}`,
                ":updatedAt": new Date().toISOString(),
            },
            ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(email)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    });

    transaction.push({
        Delete: {
            TableName: AUTH_TABLE,
            Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
        }
    });

    transaction.push({
        Put: {
            TableName: AUTH_TABLE,
            Item: {
                PK: `EMAIL#${normalizedNewEmail}`,
                SK: "UNIQUE",
                userId: id,
                GSI1SK: normalizedNewEmail,
                createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    });

    try {
        console.log("Executing transaction:", transaction);
        const result = await ddb.send(new TransactWriteCommand({
            TransactItems: transaction,
            ReturnConsumedCapacity: "TOTAL",
        }));

        if (data?.firstName || data?.lastName) {
            await updateUser(data, id);
            return json(200, { ok: true, message: "Info updated successfully" });
        }

        return result;
    } catch (err) {
        const errorName = err?.name || "";
        const msg = err?.message || "";

        if (errorName === "TransactionCanceledException" || msg.includes("ConditionalCheckFailed")) {
            return json(409, { ok: false, message: "EMAIL_ALREADY_IN_USE", meta: { email: normalizedNewEmail } });
        }

        console.error("Error in updateUserEmail function:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}