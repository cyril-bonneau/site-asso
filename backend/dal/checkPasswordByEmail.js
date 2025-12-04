import {
    QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb } from "./requestToDb.js";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

export async function checkPasswordByEmail({ password, email }) {
    const auth = await getAuthByEmail(email)

    if (!auth || !auth.passwordHash) {
        throw new Error("AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH");
    }

    if (await verifyPassword(auth.passwordHash, password)) {
        return {
            check: true,
            userId: auth.userId
        }
    } else {
        return {
            check: false
        }
    }
}

async function getAuthByEmail(email) {
    try {
        const res = await ddb.send(
            new QueryCommand({
                TableName: AUTH_TABLE,
                IndexName: "GSI1v5",
                KeyConditionExpression: "GSI1PK = :pk",
                ExpressionAttributeValues: {
                    ":pk": `EMAIL#${email}`,
                },
                ProjectionExpression: "passwordHash, userId, role",
            })
        )
        console.log("getAuthByEmail result:", res.Items[0]);
        return res.Items[0]
    } catch (err) {
        return err
    }
}