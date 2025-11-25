// backend/tests/integration/config.int.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const BASE_URL = process.env.API_BASE_URL
if (!BASE_URL) {
    throw new Error("API_BASE_URL must be set in env for integration tests");
}

const USER_TABLE = process.env.USER_TABLE;
if (!USER_TABLE) {
    throw new Error("USER_TABLE must be set in env for integration tests");
}

// Client DynamoDB (mode "Document")
const ddbClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({})
);

/**
 * Helper pour appeler ton API HTTP
 * @param {"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} method 
 * @param {string} path ex: "/auth/register"
 * @param {object | undefined} body
 */
export async function callApi(method, path, body) {
    const url = `${BASE_URL}${path}`;
    const init = {
        method,
        headers: {
            "Content-Type": "application/json",
        },
    };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    const json = await res.json().catch(() => undefined);

    return {
        status: res.status,
        body: json,
    };
}

/**
 * Vérifie qu’un profil user existe dans la USER_TABLE
 * 
 * ⚠️ Assumption : PK = `USER#${userId}` ; SK = `PROFILE#${userId}`
 * à adapter si nécessaire.
 */
export async function getUserProfileByUserId(userId) {
    const { Item } = await ddbClient.send(
        new GetCommand({
            TableName: USER_TABLE,
            Key: {
                PK: `USER#${userId}`,
                SK: `PROFILE#${userId}`,
            },
        })
    );
    return Item;
}

export { USER_TABLE };
