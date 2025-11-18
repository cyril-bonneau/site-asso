import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";

import { withRateLimit } from "../rateLimit/withRateLimit.js";
import { checkPassword } from "../helpers/checkPassword.js";
import { hashPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const USER_TABLE = process.env.USER_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export const handler = async (event) => {
    try {
        const id = event?.queryStringParameters?.id;
        if (!id) {
            return json(400, { ok: false, message: "MISSING_USER_ID" });
        }

        let data;
        try {
            data = JSON.parse(event.body || "{}");
        } catch {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" });
        }

        const oldEmail = data.oldEmail ? normalizeEmail(data.oldEmail) : undefined;
        const newEmail = data.newEmail ? normalizeEmail(data.newEmail) : undefined;
        const firstName = data.firstName;
        const lastName = data.lastName;
        const oldPassword = data.oldPassword;
        const newPassword = data.newPassword

        const hasEmailChange =
            oldEmail !== undefined && newEmail !== undefined && oldEmail !== newEmail;
        const hasProfileChange =
            firstName !== undefined || lastName !== undefined;
        const hasPasswordChange =
            oldPassword !== undefined && newPassword !== undefined;

        if ((oldPassword !== undefined) !== (newPassword !== undefined)) {
            return json(400, { ok: false, message: "MISSING_PASSWORD_FIELDS" });
        }

        // Rien à faire
        if (!hasEmailChange && !hasProfileChange && !hasPasswordChange) {
            return json(200, { ok: true, message: "NOTHING_TO_UPDATE" });
        }

        return await updateUserTransactional({
            userId: id,
            oldEmail,
            newEmail,
            firstName,
            lastName,
            oldPassword,
            newPassword,
            hasEmailChange,
            hasProfileChange,
            hasPasswordChange
        });

    } catch (err) {
        console.error("Error in updateUser handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
};

function normalizeEmail(email) {
    return String(email).trim().toLowerCase();
}

async function updateUserTransactional(params) {
    const {
        userId,
        oldEmail,
        newEmail,
        firstName,
        lastName,
        oldPassword,
        newPassword,
        hasEmailChange,
        hasProfileChange,
        hasPasswordChange
    } = params;

    const transactItems = [];

    if (hasEmailChange) {
        addEmailChangeOperations({
            transactItems,
            userId,
            oldEmail,
            newEmail,
        });
    }

    if (hasProfileChange) {
        addUserProfileUpdateOperation({
            transactItems,
            userId,
            firstName,
            lastName,
        });
    }

    if (hasPasswordChange) {
        try {
            await updatePassword({
                userId,
                oldPassword,
                newPassword,
                transactItems
            })
        } catch (err) {
            if (err.code === "WRONG_PASSWORD") {
                return json(403, { ok: false, message: "WRONG_PASSWORD" });
            }
            throw err;
        }
    }

    if (transactItems.length === 0) {
        return json(200, { ok: true, message: "NOTHING_TO_UPDATE" });
    }

    try {
        console.log("Executing TransactWrite for user:", userId, {
            hasEmailChange,
            hasProfileChange,
            opsCount: transactItems.length,
        });

        await ddb.send(
            new TransactWriteCommand({
                TransactItems: transactItems,
                ReturnConsumedCapacity: "TOTAL",
            })
        );

        return json(200, {
            ok: true, updated: {
                email: hasEmailChange,
                profile: hasProfileChange,
                password: hasPasswordChange
            }
        });
    } catch (err) {
        const errorName = err?.name || "";
        const msg = err?.message || "";

        if (
            errorName === "TransactionCanceledException" ||
            msg.includes("ConditionalCheckFailed")
        ) {
            return json(409, {
                ok: false,
                message: "EMAIL_ALREADY_IN_USE",
                meta: { email: newEmail },
            });
        }

        console.error("Error in updateUserEmail transaction:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

function addEmailChangeOperations({ transactItems, userId, oldEmail, newEmail }) {

    transactItems.push(
        {
            Delete: {
                TableName: AUTH_TABLE,
                Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
            },
        },
        {
            Delete: {
                TableName: USER_TABLE,
                Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
            },
        }
    );

    transactItems.push(
        {
            Put: {
                TableName: AUTH_TABLE,
                Item: {
                    PK: `EMAIL#${newEmail}`,
                    SK: "UNIQUE",
                    userId: `USER#${userId}`,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        },
        {
            Put: {
                TableName: USER_TABLE,
                Item: {
                    PK: `EMAIL#${newEmail}`,
                    SK: "UNIQUE",
                    userId,
                    GSI1SK: newEmail,
                    createdAt: new Date().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        }
    );

    transactItems.push(
        {
            Update: {
                TableName: AUTH_TABLE,
                Key: { PK: `USER#${userId}`, SK: "AUTH" },
                UpdateExpression:
                    "SET #email = :email, #GSI1PK = :GSI1PK, #updatedAt = :updatedAt",
                ExpressionAttributeNames: {
                    "#email": "email",
                    "#GSI1PK": "GSI1PK",
                    "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                    ":email": newEmail,
                    ":GSI1PK": `EMAIL#${newEmail}`,
                    ":updatedAt": new Date().toISOString(),
                },
                ConditionExpression: "attribute_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        },
        {
            Update: {
                TableName: USER_TABLE,
                Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
                UpdateExpression:
                    "SET #email = :email, #GSI1SK = :GSI1SK, #updatedAt = :updatedAt",
                ExpressionAttributeNames: {
                    "#email": "email",
                    "#GSI1SK": "GSI1SK",
                    "#updatedAt": "updatedAt",
                },
                ExpressionAttributeValues: {
                    ":email": newEmail,
                    ":GSI1SK": newEmail,
                    ":updatedAt": new Date().toISOString(),
                }
            }
        }
    );
}

function addUserProfileUpdateOperation({
    transactItems,
    userId,
    firstName,
    lastName,
}) {
    const exprNames = {
        "#updatedAt": "updatedAt",
    };

    const exprValues = {
        ":updatedAt": new Date().toISOString(),
    };

    let updateExpr = "SET #updatedAt = :updatedAt";

    if (firstName !== undefined) {
        exprNames["#firstName"] = "firstName";
        exprValues[":firstName"] = firstName;
        updateExpr += ", #firstName = :firstName";
    }

    if (lastName !== undefined) {
        exprNames["#lastName"] = "lastName";
        exprValues[":lastName"] = lastName;
        updateExpr += ", #lastName = :lastName";
    }

    transactItems.push({
        Update: {
            TableName: USER_TABLE,
            Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues,
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
    });
}

async function updatePasswordCore({ userId, oldPassword, newPassword, transactItems }) {

    const test = await checkPassword({ password: oldPassword, userId })

    if (!test) {
        const err = new Error("Wrong password");
        err.code = "WRONG_PASSWORD";
        throw err;
    }

    const hashedPassword = await hashPassword(newPassword)

    transactItems.push({
        Update: {
            TableName: AUTH_TABLE,
            Key: { PK: `USER#${userId}`, SK: "AUTH" },
            UpdateExpression: "SET #hashedPassword = :hashedPassword, #updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#hashedPassword": "hashedPassword",
                "#updatedAt": "updatedAt"
            },
            ExpressionAttributeValues: {
                ":hashedPassword": hashedPassword,
                ":updatedAt": new Date().toISOString()
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
    });
}

const updatePassword = withRateLimit(updatePasswordCore, {
    scope: "updatePassword",
    keySelector: ({ userId }) => `USER#${userId}`
})

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}
