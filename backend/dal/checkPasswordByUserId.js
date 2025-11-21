import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand
} from "@aws-sdk/lib-dynamodb";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function checkPasswordByUserId({ password, userId }) {
    console.log("userId", userId)
    const auth = await getAuthByUserId(userId)

    if (!auth || !auth.passwordHash) {
        console.log(auth)
        throw new Error("AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH", auth);
    }

    return verifyPassword(auth.passwordHash, password)
}

async function getAuthByUserId(userId) {
    try {
        const { Item } = await ddb.send(
            new GetCommand({
                TableName: AUTH_TABLE,
                Key: { PK: `USER#${userId}`, SK: "AUTH" },
                ProjectionExpression: "passwordHash"
            })
        )
        return Item

    } catch (err) {
        return err
    }
}