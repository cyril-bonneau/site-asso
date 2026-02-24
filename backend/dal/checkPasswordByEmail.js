import { getFromDb, queryDb } from "./requestToDb.js";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const USER_TABLE = process.env.USER_TABLE;

export async function checkPasswordByEmail({ password, email }) {
    const auth = await getAuthByEmail(email);

    if (!auth || !auth.passwordHash) {
        throw new Error("AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH");
    }

    if (await verifyPassword(auth.passwordHash, password)) {
        return {
            check: true,
            userId: auth.userId,
            privilege: auth.privilege
        }
    } else {
        await verifyPassword("$invalidHash", password); // pour résister aux attaques timing
        return {
            check: false
        }
    }
}

async function getAuthByEmail(email) {
    try {
        const res = await queryDb({
            TableName: AUTH_TABLE,
            IndexName: "GSI1v6",
            KeyConditionExpression: "GSI1PK = :pk",
            ExpressionAttributeValues: {
                ":pk": `EMAIL#${email}`,
            },
            ProjectionExpression: "passwordHash, userId",
        })
        res[0].privilege = await getPrivilegeByUserId(res[0].userId)
        return res[0]
    } catch (err) {
        return err
    }
}

async function getPrivilegeByUserId(userId) {
    try {
        const res = await getFromDb({
            TableName: USER_TABLE,
            Key: {
                "PK": `USER#${userId}`,
                "SK": `PROFILE#${userId}`
            },
            ProjectionExpression: "privilege",
        })
        console.log("getPrivilegeByUserId result:", res.privilege);
        return res.privilege
    } catch (err) {
        console.error("getPrivilegeByUserId error:", err);
        return err
    }
}