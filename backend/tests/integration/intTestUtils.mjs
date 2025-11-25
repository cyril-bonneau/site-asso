// backend/tests/integration/intTestUtils.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand,
} from "@aws-sdk/lib-dynamodb";

import { handler as registerUserHandler } from "../../lambda/registerUserLambda.js";

const REGION =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-3";

export const AUTH_TABLE = process.env.AUTH_TABLE;
export const USER_TABLE = process.env.USER_TABLE;

if (!AUTH_TABLE || !USER_TABLE) {
    throw new Error("AUTH_TABLE et USER_TABLE doivent être définies en env");
}

const ddbDoc = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION }),
    { marshallOptions: { removeUndefinedValues: true } },
);

// ---------- DynamoDB helpers ----------

export async function getItem(tableName, key) {
    const res = await ddbDoc.send(
        new GetCommand({
            TableName: tableName,
            Key: key,
            ConsistentRead: true,
        }),
    );
    return res.Item || null;
}

export async function getAuthEmailEntry(email) {
    return getItem(AUTH_TABLE, { PK: `EMAIL#${email}`, SK: "UNIQUE" });
}

export async function getAuthUserEntry(userId) {
    return getItem(AUTH_TABLE, { PK: `USER#${userId}`, SK: "AUTH" });
}

export async function getUserEmailEntry(email) {
    return getItem(USER_TABLE, { PK: `EMAIL#${email}`, SK: "UNIQUE" });
}

export async function getUserProfileEntry(userId) {
    return getItem(USER_TABLE, {
        PK: `USER#${userId}`,
        SK: `PROFILE#${userId}`,
    });
}

export function extractLogicalUserIdFromAuthEmail(entry) {
    if (!entry?.userId || typeof entry.userId !== "string") {
        throw new Error("Auth EMAIL entry has no valid userId");
    }
    const raw = entry.userId;
    if (raw.startsWith("USER#")) return raw.slice("USER#".length);
    return raw;
}

export async function waitForProjection({ email, userId, timeoutMs = 10_000 }) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const [emailItem, profileItem] = await Promise.all([
            getUserEmailEntry(email),
            getUserProfileEntry(userId),
        ]);

        if (emailItem && profileItem) return { emailItem, profileItem };
        await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
        `Projection USER_TABLE non visible après ${timeoutMs}ms pour ${email}`,
    );
}

export async function waitForDeletion({ email, userId, timeoutMs = 10_000 }) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const [emailItem, profileItem] = await Promise.all([
            getUserEmailEntry(email),
            getUserProfileEntry(userId),
        ]);

        if (!emailItem && !profileItem) return;
        await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
        `Entrées USER_TABLE toujours présentes après ${timeoutMs}ms pour ${email}`,
    );
}

// ---------- Lambda invocation helper (gère also le rate-limit) ----------

let ipCounter = 0;
function nextIp(label = "test") {
    ipCounter += 1;
    // juste besoin d'une string stable par appel, peu importe la tête
    return `10.${ipCounter % 255}.${label.length}.${ipCounter}`;
}

/**
 * Appelle un handler Lambda "façon API Gateway" sans mock.
 * - handler: (event, context) => Promise<{ statusCode, body }>
 * - opts.body: objet -> sera JSON.stringifié
 * - opts.rawBody: string brute (pour tester INVALID_JSON_BODY)
 * - opts.query: { ... } -> queryStringParameters
 * - opts.ipLabel: pour séparer les seaux de rate-limit
 */
export async function invokeLambda(handler, opts = {}) {
    const { body, rawBody, query, ipLabel } = opts;

    const event = {};
    if (rawBody !== undefined) {
        event.body = rawBody;
    } else if (body !== undefined) {
        event.body = JSON.stringify(body);
    }

    if (query) {
        event.queryStringParameters = query;
    }

    event.requestContext = {
        http: {
            sourceIp: ipLabel ? `${ipLabel}-${nextIp(ipLabel)}` : nextIp("anon"),
        },
    };

    const resp = await handler(event, {});
    const statusCode = resp?.statusCode ?? 200;
    const rawBodyResp = resp?.body;

    let parsedBody = null;
    if (typeof rawBodyResp === "string") {
        try {
            parsedBody = JSON.parse(rawBodyResp);
        } catch {
            parsedBody = null;
        }
    } else if (rawBodyResp !== undefined) {
        parsedBody = rawBodyResp;
    }

    return { statusCode, body: parsedBody, raw: resp };
}

// ---------- Helpers de création d'utilisateur de test ----------

export async function createTestUser({
    suffix = "int",
    passwordLabel = "A",
} = {}) {
    const ts = Date.now();
    const email = `int-${suffix}-${ts}@example.com`.toLowerCase();
    const password = `Str0ng!Passw0rd-${passwordLabel}-${ts}`;

    const { statusCode, body } = await invokeLambda(registerUserHandler, {
        body: { email, password },
        ipLabel: `reg-${suffix}`,
    });

    if (statusCode !== 201 || !body?.ok) {
        throw new Error(
            `Échec création user test: ${statusCode} ${JSON.stringify(body)}`,
        );
    }

    const emailEntry = await getAuthEmailEntry(email);
    if (!emailEntry) {
        throw new Error(
            `Auth EMAIL entry non trouvée pour ${email} après register`,
        );
    }

    const userId = extractLogicalUserIdFromAuthEmail(emailEntry);
    return { email, password, userId };
}
