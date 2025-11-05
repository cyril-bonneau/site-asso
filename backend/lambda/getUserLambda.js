import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.DDB_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export const handler = async (event) => {
    try {
        const data = JSON.parse(event.body);
        const email = String(data.email).trim().toLowerCase();
        if (data?.userId) {
            return getUserDataById(data.userId);
        }

        const gotUserId = await getUserId(email);
        if (gotUserId.statusCode !== 200) {
            return json(gotUserId.statusCode, { error: "USER_NOT_FOUND" });
        }
        const afterParse = JSON.parse(gotUserId.body);
        console.log("gotUserId:", afterParse);
        return getUserDataById(afterParse.data);

    } catch (err) {
        console.error("Error in getUserData handler:", err);
        return {
            statusCode: err.statusCode || 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    }
}

async function getUserId(email) {
    try {
        const command = new GetCommand({
            TableName: TABLE,
            Key: {
                PK: `EMAIL#${email}`,
                SK: "UNIQUE"
            },
            // ProjectionExpression: "name, familyName",
            // ConsistentRead: false
        })

        const getId = await ddb.send(command);

        if (!getId.Item) {
            return json(404, { ok: false, message: "USER_NOT_FOUND" });
        }

        console.log("getUserId found userId:", getId.Item.userId);

        return json(200, { ok: true, message: "User data retrieved successfully", data: getId.Item?.userId });

    } catch (err) {
        console.error("Error in getUserData function getUserId:", err);
        return {
            statusCode: err.statusCode || 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    }
}

async function getUserDataById(id) {
    try {
        const userCommand = new GetCommand({
            TableName: TABLE,
            Key: {
                PK: `USER#${id}`,
                SK: `PROFILE#${id}`
            },
            ProjectionExpression: "email, firstName, lastName, updatedAt",
            ConsistentRead: true,
        })

        const result = await ddb.send(userCommand);

        return json(200, { ok: true, message: "User data retrieved successfully", data: result.Item });

    } catch (err) {
        console.error("Error in getUserData function getUserDataById:", err);
        return {
            statusCode: err.statusCode || 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    }
}

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}