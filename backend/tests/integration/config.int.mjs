// backend/tests/integration/config.int.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const BASE_URL = process.env.API_BASE_URL;
if (!BASE_URL) {
    throw new Error("API_BASE_URL must be set in env for integration tests");
}

const USER_TABLE = process.env.USER_TABLE;
if (!USER_TABLE) {
    throw new Error("USER_TABLE must be set in env for integration tests");
}

const ddbClient = DynamoDBDocumentClient.from(
    new DynamoDBClient({})
);

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

// --- Helpers DB ---

function normalizeEmailForTest(email) {
    return email.trim().toLowerCase();
}

// Récupérer userId à partir de l’email (via l’item EMAIL#... / UNIQUE)
export async function getUserIdByEmail(email) {
    const normalized = normalizeEmailForTest(email);
    const { Item } = await ddbClient.send(
        new GetCommand({
            TableName: USER_TABLE,
            Key: {
                PK: `EMAIL#${normalized}`,
                SK: "UNIQUE",
            },
        })
    );
    return Item?.userId;
}

// Polling pour laisser le temps au stream de projeter les données
export async function waitForUserIdByEmail(email, {
    timeoutMs = 5000,
    intervalMs = 250,
} = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const id = await getUserIdByEmail(email);
        if (id) return id;
        await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for USER_TABLE projection for email ${email}`);
}

// Vérifier le profil par userId (item USER#... / PROFILE#...)
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
