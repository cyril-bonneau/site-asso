import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js"
import { parse } from "cookie"
import { getFromDb, sendUpdateToDb } from "../dal/requestToDb.js";
import { jwtVerify } from "jose";
import { json, hashRefreshToken } from "../helpers/toolbox.js";
import crypto from "crypto";
import { generateNewRefreshToken } from "../helpers/generateNewRefreshToken.js";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

const TOKEN_TABLE = process.env.TOKEN_TABLE
const USER_TABLE = process.env.USER_TABLE
const REFRESH_JWT_HMAC = crypto
    .createSecretKey(Buffer.from(process.env.REFRESH_JWT_HMAC, "utf-8"));

export const handler = async (event) => {
    try {

        // scénario :
        // le front fait un appel à cette lambda pour rafraîchir son auth user lorsque l'access token est à 5min d'éxpirer
        // le front envoi alors le refresh token stocké dans les cookies httpOnly et l'access token dans l'entête Authorization Bearer

        // 1. récupérer le refresh token dans les cookies
        // 2. vérifier et décoder le refresh token
        // 3. hash le refresh token et récupérer les données en base
        // 4. Tente un update de décrément de useRemaining du refresh token en base
        // si échec, renvoyer une erreur 401 (token invalide, expiré ou plus de useRemaining)
        // 5. récupérer les infos user en base
        // 6. générer un nouvel access token
        // 7. si le refresh token a plus de 30min, en générer un nouveau et le stocker en base + renvoyer le cookie au front
        const refreshToken = getRefreshTokenFromEvent(event);
        if (refreshToken === null) return json(401, { ok: false, message: "REFRESH_TOKEN_NOT_FOUND" })

        const result = await getRefreshTokenData(refreshToken);

        const refreshHash = hashRefreshToken(refreshToken);
        // console.log("refreshHash", refreshHash)

        const updatedData = await updateRefreshTokenUsage(refreshHash);

        const userData = await getUserData(result.userId);

        const payload = {
            userId: userData.userId,
            email: userData.email,
            privilege: userData.privilege
        };

        const accessToken = await signAccessTokenWithKms(payload);

        if (updatedData.useRemaining <= 0) { // update only when useRemaining equal 0
            const cookieString = await generateNewRefreshToken(result.userId, REFRESH_JWT_HMAC, refreshHash);

            return json(
                200,
                {
                    userId: userData.userId,
                    message: "AUTH_VALIDATED",
                    accessToken,
                },
                {
                    "Set-Cookie": cookieString
                }
            );
        }

        return json(200, {
            userId: userData.userId,
            message: "AUTH_VALIDATED",
            accessToken,
        });

    } catch (err) {
        console.error("Fatal error in refresh auth user handler:", err);
        if (err.message === "REFRESH_TOKEN_NOT_FOUND" ||
            err.message === "REFRESH_TOKEN_INVALID" ||
            err.message === "REFRESH_TOKEN_EXPIRED" ||
            err.message === "USER_NOT_FOUND" ||
            err instanceof ConditionalCheckFailedException) {
            return json(401, { ok: false, message: err.message });
        }
        return json(500, { ok: false, message: err.message || "INTERNAL_ERROR" });
    }
}

function getRefreshTokenFromEvent(event) {
    if (!event.cookies) return null;

    const parsed = parse(event.cookies.join("; "));
    return parsed.refreshToken ?? null;
}

// algo must be HS256 or other symmetric algorithm
async function getRefreshTokenData(refreshToken) {
    try {
        const { payload } = await jwtVerify(
            refreshToken,
            REFRESH_JWT_HMAC,
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

async function updateRefreshTokenUsage(refreshHash) {

    const req = {
        TableName: TOKEN_TABLE,
        Key: {
            PK: refreshHash,
            SK: 'REFRESH',
        },
        UpdateExpression: "SET useRemaining = useRemaining - :dec",
        ExpressionAttributeValues: {
            ":dec": 1,
            ":now": Math.floor(Date.now() / 1000),
            ":zero": 0
        },
        ConditionExpression: "attribute_exists(PK) AND useRemaining > :zero AND expiredAt > :now",
        ReturnValues: "UPDATED_NEW"
    }
    return await sendUpdateToDb(req);
}