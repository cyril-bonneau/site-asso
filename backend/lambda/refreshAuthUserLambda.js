import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js"
import { parse } from "cookie"
import { getFromDb } from "../dal/requestToDb.js";
import { jwtVerify } from "jose";
import { json, hashRefreshToken } from "../helpers/toolbox.js";
import crypto from "crypto";

const TOKEN_TABLE = process.env.TOKEN_TABLE
const SECRET_HMAC = process.env.REFRESH_JWT_HMAC
const USER_TABLE = process.env.USER_TABLE

export const handler = async (event) => {
    try {
        const refreshToken = getRefreshTokenFromEvent(event);
        if (refreshToken === null) return json(404, { ok: false, message: "REFRESH_TOKEN_NOT_FOUND" })

        const result = await getRefreshTokenData(refreshToken);

        const refreshHash = hashRefreshToken(refreshToken);
        console.log("refreshHash", refreshHash)

        if (!await checkRefreshTokenInDb(refreshHash)) {
            return json(404, { ok: false, message: "REFRESH_TOKEN_EXPIRED" });
        }
        const userData = await getUserData(result.userId);

        const payload = {
            userId: userData.userId,
            email: userData.email,
            privilege: userData.privilege
        };
        const accessToken = await signAccessTokenWithKms(payload);

        return json(200, {
            userId: userData.userId,
            message: "AUTH_VALIDATED",
            accessToken,
        });
    } catch (err) {
        console.error("Fatal error in refresh auth user handler:", err);
        return json(500, { ok: false, message: err.message || "INTERNAL_ERROR" });
    }
}

function getRefreshTokenFromEvent(event) {
    if (!event.cookies) return null;

    const parsed = parse(event.cookies.join("; "));
    return parsed.refreshToken ?? null;
}

/**
 * normally should return :
 * {
 *   userId: 'USER#uuid',
 *   refreshToken: 'the-refresh-token',
 *   issuedAt: timestamp,
 *   expiredAt: timestamp
 * }
*/
async function checkRefreshTokenInDb(refreshHash) {

    const req = {
        TableName: TOKEN_TABLE,
        Key: {
            PK: refreshHash,
            SK: 'REFRESH',
        }
    };
    const data = await getFromDb(req);
    if (data === undefined || data.expiredAt < Math.floor(Date.now() / 1000)) {
        throw new Error("REFRESH_TOKEN_NOT_FOUND")
    }
    return true;
}

async function getRefreshTokenData(refreshToken) {
    try {
        const secret = new TextEncoder().encode(SECRET_HMAC);
        const { payload } = await jwtVerify(
            refreshToken,
            secret,
            {
                algorithms: ['HS256'],
                // issuer: 'site-asso/api',
                // audience: 'site-asso/frontend',
            }
        )

        console.log("refresh token payload", payload)

        const nowSec = Math.floor(Date.now() / 1000)
        if (payload.expiredAt < nowSec) {
            throw new Error("REFRESH_TOKEN_EXPIRED")
        }
        return {
            userId: payload.userId,
            issuedAt: payload.issuedAt,
            expiredAt: payload.expiredAt,
        }
    } catch (err) {
        throw new Error("REFRESH_TOKEN_INVALID")
    }
}

/**
 * normally should return :
 * {
 *   userId: 'USER#uuid',
 *   email: 'user email',
 *   firstName: 'First',
 *   lastName: 'Last',
 *   privilege: 'user|admin',
 *   createdAt: timestamp,
 * }
*/
async function getUserData(userId) {
    const req = {
        TableName: USER_TABLE,
        Key: {
            PK: `USER#${userId}`,
            SK: `PROFILE#${userId}`,
        }
    }
    const data = await getFromDb(req);
    if (data === undefined) {
        throw new Error("USER_NOT_FOUND")
    }
    return data;
}