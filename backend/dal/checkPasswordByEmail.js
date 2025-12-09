import {
    GetCommand,
    QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { ddb } from "./requestToDb.js";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const USER_TABLE = process.env.USER_TABLE;

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
                ProjectionExpression: "passwordHash, userId",
            })
        )
        console.log("getAuthByEmail result:", res.Items[0]);
        res.Items[0].privilege = await getPrivilegeByUserId(res.Items[0].userId)
        return res.Items[0]
    } catch (err) {
        return err
    }
}

async function getPrivilegeByUserId(userId) {
    try {
        const res = await ddb.send(
            new GetCommand({
                TableName: USER_TABLE,
                Key: {
                    "PK": `USER#${userId}`,
                    "SK": `PROFILE#${userId}`
                },
                ProjectionExpression: "privilege",
            })
        )
        console.log("getPrivilegeByUserId result:", res.Items[0]);
        return res.Items.privilege
    } catch (err) {
        console.error("getPrivilegeByUserId error:", err);
        return err
    }
}