import { checkPasswordByUserId } from "./checkPasswordByUserId.js";
import { hashPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

export async function updatePasswordCore({ userId, oldPassword, newPassword }) {
    const test = await checkPasswordByUserId({ password: oldPassword, userId })

    if (!test) {
        const err = new Error("Wrong password");
        err.code = "WRONG_PASSWORD";
        throw err;
    }

    const hashedPassword = await hashPassword(newPassword)

    return [{
        Update: {
            TableName: AUTH_TABLE,
            Key: { PK: `USER#${userId}`, SK: "AUTH" },
            UpdateExpression: "SET #passwordHash = :passwordHash, #updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#passwordHash": "passwordHash",
                "#updatedAt": "updatedAt"
            },
            ExpressionAttributeValues: {
                ":passwordHash": hashedPassword,
                ":updatedAt": new Date().toISOString()
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
    }]
}
