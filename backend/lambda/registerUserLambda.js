import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { validatePasswordBackend } from "../auth/passwordPolicy.js";
import argon2 from 'argon2';
import { nanoid } from "nanoid";
import { withRateLimit } from "../rateLimit/withRateLimit.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

// event must contain email, password in body

export const handler = withRateLimit(registerUserCore, {
    scope: "REGISTER",     // nom logique de l’action
    capacity: 3,
    refillRate: 0.1,       // 1 token / 10 s
    cost: 1,
    keyFromEvent: (event) => {
        // avant auth: mieux vaut l’IP
        const ip = event?.requestContext?.http?.sourceIp
            || event?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim();
        return ip || "unknown";
    }
})

async function registerUserCore(event) {
    try {
        const { email, password } = JSON.parse(event.body);

        const check = await validatePasswordBackend(password, {
            email,
            // username: data.username,
            useHIBP: true // ou false si tu veux éviter l'appel externe
        });

        if (!check.ok) {
            return {
                statusCode: 422,
                body: JSON.stringify({ ok: false, code: "WEAK_PASSWORD", reasons: check.reasons })
            };
        }

        const res = await createAuthEntry(email, password);

        if (res.statusCode === 200) return json(201, { ok: true, message: res.message });

        return json(res.statusCode, { ok: false, ...res })


    } catch (err) {
        return {
            statusCode: err.statusCode || 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    }
}

async function createAuthEntry(email, password) {

    const normalizedEmail = String(email).trim().toLowerCase();
    const hashedPwd = await hashPassword(password);
    const maxIdRetries = 3;
    for (let attempt = 0; attempt < maxIdRetries; attempt++) {
        const id = nanoid();
        const now = new Date().toISOString()

        const transaction = []

        transaction.push({
            Put: {
                TableName: AUTH_TABLE,
                Item: {
                    PK: `EMAIL#${normalizedEmail}`,
                    SK: "UNIQUE",
                    userId: `USER#${id}`,
                    createdAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            }
        });

        transaction.push({
            Put: {
                TableName: AUTH_TABLE,
                Item: {
                    PK: `USER#${id}`,
                    SK: "AUTH",
                    userId: id,
                    GSI1PK: `EMAIL#${normalizedEmail}`,
                    GSI1SK: `USER#${id}`,
                    email: normalizedEmail,
                    passwordHash: hashedPwd,
                    createdAt: now,
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        });

        try {
            const response = await ddb.send(new TransactWriteCommand({
                TransactItems: transaction,
                ReturnCancellationReasons: true,
                ReturnConsumedCapacity: "TOTAL",
            }));

            if (response.$metadata.httpStatusCode === 200) {
                console.log("createAuthEntry success", { email: normalizedEmail, userId: id })
                return {
                    statusCode: response.$metadata.httpStatusCode,
                    message: "user successfully created"
                }
            }

        } catch (err) {

            if (err.name === "TransactionCanceledException" && err.CancellationReasons) {
                const reasons = err.CancellationReasons.map((r, i) => ({
                    index: i,
                    opType: Object.keys(transaction[i])[0],
                    code: r.Code,
                    message: r.Message,
                }));

                const emailCheck = reasons.find(r => r.index === 0);

                if (emailCheck && emailCheck.code === "ConditionalCheckFailed") {
                    return { statusCode: 409, error: "EMAIL_ALREADY_EXISTS" }
                }

                const checkId = reasons.find(r => r.index === 1);

                if (checkId && checkId.code === "ConditionalCheckFailed") {
                    console.error("ID_COLLISION RETRYING...");
                    if (attempt < maxIdRetries - 1) {
                        await new Promise(r => setTimeout(r, 25 * (attempt + 1)));
                        continue;
                    }
                    console.log({ error: "ID_COLLISION" })
                    throw { statusCode: 409, error: "ID_COLLISION" }
                };
            }
            console.error("Error in createAuthEntry transaction:", err);
            return { statusCode: 500, error: "INTERNAL_ERROR" };
        }
    }
}

async function hashPassword(pwd) {
    return argon2.hash(pwd, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
    });
}

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}