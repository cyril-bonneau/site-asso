import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import argon2 from 'argon2';
import { nanoid } from "nanoid";

const USER_TABLE = process.env.DDB_TABLE;
const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

// event must contain email, password in body

export const handler = async (event) => {
    try {
        const data = JSON.parse(event.body);

        const res = await createAuthEntry(data.email, data.password);

        if (res.statusCode !== 200 && res.statusCode !== 201) {
            return json(res.statusCode, { ok: false, message: res })
        }

        return json(res.statusCode, { ok: true, message: res.message });

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

        const transaction = []

        transaction.push({
            Put: {
                TableName: AUTH_TABLE,
                Item: {
                    PK: `EMAIL#${normalizedEmail}`,
                    SK: "UNIQUE",
                    GSI1PK: `USER#${id}`,
                    GSI1SK: "UNIQUE",
                    id: id,
                    email: normalizedEmail,
                    passwordHash: hashedPwd,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(id)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            }
        });

        transaction.push({
            Put: {
                TableName: USER_TABLE,
                Item: {
                    PK: `EMAIL#${normalizedEmail}`,
                    SK: "UNIQUE",
                    userId: id,
                    GSI1SK: normalizedEmail,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        });

        transaction.push({
            Put: {
                TableName: USER_TABLE,
                Item: {
                    PK: `USER#${id}`,
                    SK: `PROFILE#${id}`,
                    GSI1PK: "USER#EMAIL",
                    GSI1SK: normalizedEmail,
                    email: normalizedEmail,
                    userId: id,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            }
        })

        try {
            const response = await ddb.send(new TransactWriteCommand({
                TransactItems: transaction,
                ReturnCancellationReasons: true,
                ReturnConsumedCapacity: "TOTAL",
            }));

            if (response.$metadata.httpStatusCode === 201 || response.$metadata.httpStatusCode === 200) {
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
                const emailCheck2 = reasons.find(r => r.index === 1);

                if (emailCheck.code === "ConditionalCheckFailed" || emailCheck2.code === "ConditionalCheckFailed") {
                    return { statusCode: 403, error: "EMAIL_ALREADY_EXISTS" }
                }

                const checkId = reasons.find(r => r.index === 2);

                if (checkId.code === "ConditionalCheckFailed") {
                    console.error("ID_COLLISION RETRYING...");
                    if (attempt < maxIdRetries - 1) {
                        await new Promise(r => setTimeout(r, 25 * (attempt + 1)));
                        continue;
                    }
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

async function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}