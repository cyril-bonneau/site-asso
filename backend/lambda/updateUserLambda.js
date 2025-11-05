import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { buildDynUpdate } from "../helpers/updateUser.js";

const TABLE = process.env.DDB_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

// event must contain userId in pathParameters and fields to update in body (if email is to be updated, use oldEmail and newEmail field)
export const handler = async (event) => {
    try {
        const data = JSON.parse(event.body);
        const id = event?.queryStringParameters?.id;
        console.log("updateUser handler data:", data);
        if (!event?.queryStringParameters?.id) {
            return json(400, { error: "MISSING_USER_ID" });
        }
        if (data?.newEmail && data?.oldEmail !== data?.newEmail) {
            return updateUserEmail(data, id);
        } else {
            return updateUser(data, id);
        }
    } catch (err) {
        console.error("Error in updateUser handler:", err);
        return {
            statusCode: err.statusCode || 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    } // if newEmail is present then update email with uniqueness check else update other fields
}

async function updateUser(data, id) {

    const expr = buildDynUpdate(data, { allow: ["firstName", "lastName"] });

    if (!expr) {
        return json(400, { ok: false, message: "NO_FIELDS_TO_UPDATE" });
    }

    const result = await ddb.send(new TransactWriteCommand({
        TransactItems: [
            {
                Update: {
                    TableName: TABLE,
                    Key: {
                        PK: `USER#${id}`,
                        SK: `PROFILE#${id}`,
                    },
                    ...expr
                }
            }
        ]
    }))

    return json(200, { ok: true, message: "User updated successfully", data: result.Attributes });
}

async function updateUserEmail(data, id) {

    console.log("data contain what ?", data);

    const oldEmail = data?.oldEmail;
    const normalizedNewEmail = String(data?.newEmail).trim().toLowerCase();

    const transaction = []

    transaction.push({
        Update: {
            TableName: TABLE,
            Key: { PK: `USER#${id}`, SK: `PROFILE#${id}` },
            UpdateExpression: `SET #email = :email, #GSI1SK = :GSI1SK, #updatedAt = :updatedAt`,
            ExpressionAttributeNames: {
                "#email": "email",
                "#GSI1SK": "GSI1SK",
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":email": normalizedNewEmail,
                ":GSI1SK": normalizedNewEmail,
                ":updatedAt": new Date().toISOString(),
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    });

    transaction.push({
        Delete: {
            TableName: TABLE,
            Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
        }
    });

    transaction.push({
        Put: {
            TableName: TABLE,
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

        return json(200, { ok: true, message: "Email updated successfully", result });
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