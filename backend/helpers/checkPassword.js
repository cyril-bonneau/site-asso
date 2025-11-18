import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    GetCommand
} from "@aws-sdk/lib-dynamodb";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function checkPassword({ password, userId }) {
    try {
        const { Item } = await ddb.send(
            new GetCommand({
                TableName: AUTH_TABLE,
                Key: { PK: `USER#${userId}`, SK: "AUTH" },
                ProjectionExpression: "passwordHash"
            })
        )

        return verifyPassword(Item.passwordHash, password)

    } catch (err) {
        return err
    }
}