import { getFromDb } from "./requestToDb.js";

import { verifyPassword } from "../auth/auth.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const USER_TABLE = process.env.USER_TABLE;

export async function checkPasswordByEmail({ password, email }) {
    const auth = await getAuthByEmail(email);

    console.log("Auth retrieved for email check:", auth);

    if (!auth || !auth.passwordHash) {
        throw new Error("AUTH_NOT_FOUND_OR_MISSING_PASSWORD_HASH");
    }

    if (await verifyPassword(auth.passwordHash, password)) {
        if (auth.validated === false) {
            return {
                check: true,
                userId: auth.userId,
                privilege: auth.privilege,
                validated: auth.validated
            }
        }
        return {
            check: true,
            userId: auth.userId,
            privilege: auth.privilege
        }
    } else {
        const dummyHash = "$argon2id$v=19$m=65536,t=3,p=4$invalidsalt$invalidhash";
        try {
            await verifyPassword(dummyHash, password); // pour résister aux attaques timing
        } catch (err) {
            console.error("Error during dummy password verification:", err);
            return { check: false }; // En cas d'erreur inattendue, on retourne false pour éviter de révéler des informations
        }
        return {
            check: false
        }
    }
}

async function getAuthByEmail(email) {
    try {
        let result;

        result = await getFromDb({
            TableName: AUTH_TABLE,
            Key: {
                "PK": `EMAIL#${email}`,
                "SK": "UNIQUE",
            },
            ProjectionExpression: "userId, validated",
        });
        console.log("getAuthByEmail - userId get result:", result);
        const index = result.userId.indexOf("#"); // Extraire l'userId du format "USER#<userId>"
        const userId = index === -1 ? null : result.userId.slice(index + 1);
        console.log("getAuthByEmail - extracted userId:", userId);
        const validated = result.validated;

        result = await getFromDb({
            TableName: AUTH_TABLE,
            Key: {
                "PK": `USER#${userId}`,
                "SK": "AUTH",
            },
            ProjectionExpression: "passwordHash",
        })
        console.log("getAuthByEmail - passwordHash get raw result:", result);
        const passwordHash = result.passwordHash;
        console.log("getAuthByEmail - passwordHash get result:", passwordHash);

        const res = {
            userId,
            validated,
            passwordHash
        }

        console.log("getAuthByEmail - auth result before privilege:", res);

        res.privilege = await getPrivilegeByUserId(userId)
        console.log("getAuthByEmail - final auth result:", res);
        return res
    } catch (err) {
        console.error("getAuthByEmail error:", err);
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