import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

const AUTH_TABLE = process.env.AUTH_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

// event must contain userId in pathParameters and fields to update in body 
// (if email is to be updated, use oldEmail and newEmail field)

export const handler = async (event) => {
    try {
        const data = JSON.parse(event.body);
        data.newEmail = String(data?.newEmail).trim().toLowerCase();
        const id = event?.queryStringParameters?.id;
        console.log("updateUser handler data:", data);
        if (!event?.queryStringParameters?.id) {
            return json(400, { error: "MISSING_USER_ID" });
        }

        if (data.oldEmail === data.newEmail) {
            return ({ message: "rien à changer" })
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

    console.log("data", data)
    const oldEmail = data?.oldEmail;

    const transaction = []

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
                userId: `USER#${id}`,
                createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    });

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
            ConditionExpression: "",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    });

    try {
        console.log("Executing transaction:", transaction);
        const result = await ddb.send(new TransactWriteCommand({
            TransactItems: transaction,
            ReturnConsumedCapacity: "TOTAL",
        }));

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