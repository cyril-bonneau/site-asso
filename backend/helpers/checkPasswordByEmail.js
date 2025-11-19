import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    QueryCommand
} from "@aws-sdk/lib-dynamodb";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function checkPasswordByEmail({ password, email }) {
    const auth = await getAuthByEmail(email)

    if (!auth || !auth.passwordHash) {
        throw
    }

    return verifyPassword(auth.passwordHash, password)
}

async function getAuthByEmail(email) {
    try {
        return { Item } = await ddb.send(
            new QueryCommand({
                TableName: AUTH_TABLE,
                IndexName: "GSI1",
                KeyConditionExpression: "GSI1PK = :pk",
                ExpressionAttributeValues: {
                    ":pk": `EMAIL#${email}`,
                },
                ProjectionExpression: "PK, userId, passwordHash",
            })
        )

    } catch (err) {
        return err
    }
}