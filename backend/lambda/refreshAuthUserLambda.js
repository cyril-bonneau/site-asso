import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js";
import { parse } from "cookie";
import { getFromDb, sendUpdateToDb } from "../dal/requestToDb.js";
import { jwtVerify } from "jose";
import { json, hashRefreshToken } from "../helpers/toolbox.js";
import { validateCsrfHeaders } from "../helpers/validateCsrf.js";
import crypto from "crypto";
import { generateNewRefreshToken } from "../helpers/generateNewRefreshToken.js";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

const TOKEN_TABLE = process.env.TOKEN_TABLE;
const USER_TABLE = process.env.USER_TABLE;

// Clé HMAC pour signer/vérifier les refresh tokens (HS256)
const REFRESH_JWT_HMAC = crypto
    .createSecretKey(Buffer.from(process.env.REFRESH_JWT_HMAC, "utf-8"));

/**
 * Handler principal : émet un nouvel access token à partir du refresh token cookie.
 *
 * Flux :
 *  1. Protection CSRF : vérifie Origin + X-Requested-With (SameSite=None oblige)
 *  2. Extraction du refresh token depuis le cookie httpOnly
 *  3. Vérification de la signature HS256 et de l'expiration du refresh token
 *  4. Décrémentation atomique de useRemaining en DynamoDB (avec condition d'expiration)
 *  5. Récupération du profil utilisateur en base
 *  6. Émission d'un nouvel access token (RS256 via KMS)
 *  7. Si useRemaining atteint 0 → rotation du refresh token (nouveau cookie)
 */
export const handler = async (event) => {
    try {

        // --- Étape 1 : protection CSRF ---
        // Cette route utilise uniquement le cookie httpOnly (pas de Bearer token).
        // Sans cette vérification, SameSite=None + credentials:include = CSRF possible.
        const csrfCheck = validateCsrfHeaders(event);
        if (!csrfCheck.ok) {
            console.warn("[refreshAuthUser] Requête bloquée par la protection CSRF :", csrfCheck.reason);
            return json(403, { ok: false, message: "FORBIDDEN", code: "CSRF_VALIDATION_FAILED" });
        }

        // --- Étape 2 : extraction du refresh token depuis le cookie ---
        const refreshToken = extractRefreshTokenFromCookies(event);
        if (refreshToken === null) {
            return json(401, { ok: false, message: "REFRESH_TOKEN_NOT_FOUND" });
        }

        // --- Étape 3 : vérification de la signature et de l'expiration du refresh token ---
        const refreshTokenData = await verifyAndDecodeRefreshToken(refreshToken);

        // --- Étape 4 : décrémentation atomique en DynamoDB ---
        // La condition DynamoDB garantit : token existant + useRemaining > 0 + non expiré
        const refreshTokenHash = hashRefreshToken(refreshToken);
        const updatedTokenEntry = await decrementRefreshTokenUsage(refreshTokenHash);

        // --- Étape 5 : récupération du profil utilisateur ---
        const userProfile = await fetchUserProfile(refreshTokenData.userId);

        // --- Étape 6 : émission d'un nouvel access token ---
        const accessTokenPayload = {
            userId: userProfile.userId,
            privilege: userProfile.privilege,
        };
        const newAccessToken = await signAccessTokenWithKms(accessTokenPayload);

        // --- Étape 7 : rotation du refresh token si useRemaining atteint 0 ---
        // Quand useRemaining <= 0, le token est épuisé → on en génère un nouveau
        // et on supprime l'ancien de manière atomique en DynamoDB.
        if (updatedTokenEntry.useRemaining <= 0) {
            const newRefreshTokenCookie = await generateNewRefreshToken(
                refreshTokenData.userId,
                REFRESH_JWT_HMAC,
                refreshTokenHash, // passé pour supprimer l'ancien token atomiquement
            );

            return json(
                200,
                {
                    ok: true,
                    userId: userProfile.userId,
                    message: "AUTH_VALIDATED",
                    accessToken: newAccessToken,
                },
                [newRefreshTokenCookie]
            );
        }

        // Pas de rotation nécessaire : on renvoie juste le nouvel access token
        return json(200, {
            ok: true,
            userId: userProfile.userId,
            message: "AUTH_VALIDATED",
            accessToken: newAccessToken,
        });

    } catch (err) {
        console.error("[refreshAuthUser] Erreur fatale :", err.message);

        // Erreurs attendues → 401 (token invalide, expiré, introuvable, épuisé)
        const isExpectedAuthError = (
            err.message === "REFRESH_TOKEN_NOT_FOUND" ||
            err.message === "REFRESH_TOKEN_INVALID" ||
            err.message === "REFRESH_TOKEN_EXPIRED" ||
            err.message === "USER_NOT_FOUND" ||
            err instanceof ConditionalCheckFailedException
        );

        if (isExpectedAuthError) {
            return json(401, { ok: false, message: err.message });
        }

        // Erreur inattendue → message générique pour ne pas exposer les détails internes
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
};

/**
 * Extrait le refresh token depuis les cookies de l'événement Lambda.
 * Retourne null si aucun cookie n'est présent ou si le cookie refreshToken est absent.
 *
 * @param {Object} event - Événement Lambda
 * @returns {string|null}
 */
function extractRefreshTokenFromCookies(event) {
    if (!event.cookies || event.cookies.length === 0) {
        return null;
    }

    const parsedCookies = parse(event.cookies.join("; "));

    return parsedCookies.refreshToken ?? null;
}

/**
 * Vérifie la signature HS256 du refresh token et son expiration.
 *
 * jose.jwtVerify() valide automatiquement le claim standard `exp` (RFC 7519 §4.1.4).
 * Si le token est expiré ou si la signature est invalide, jose lève une erreur.
 *
 * Toutes les erreurs sont normalisées en REFRESH_TOKEN_INVALID pour ne pas
 * révéler la raison exacte du rejet au client.
 *
 * @param {string} refreshToken - Token JWT brut extrait du cookie
 * @returns {Promise<{ userId: string }>}
 */
async function verifyAndDecodeRefreshToken(refreshToken) {
    try {
        const { payload } = await jwtVerify(refreshToken, REFRESH_JWT_HMAC, {
            algorithms: ["HS256"],
            issuer: process.env.JWT_ISSUER || "site-asso/api",
            audience: process.env.JWT_AUDIENCE || "site-asso/frontend",
        });

        return {
            userId: payload.userId,
        };

    } catch (err) {
        // Normalisation : on ne distingue pas signature invalide / expirée / malformée
        throw new Error("REFRESH_TOKEN_INVALID");
    }
}

/**
 * Récupère le profil utilisateur depuis DynamoDB.
 * Contient : userId, email, firstName, lastName, privilege, createdAt
 *
 * @param {string} userId - Identifiant utilisateur brut (sans préfixe "USER#")
 * @returns {Promise<Object>}
 */
async function fetchUserProfile(userId) {
    const getRequest = {
        TableName: USER_TABLE,
        Key: {
            PK: `USER#${userId}`,
            SK: `PROFILE#${userId}`,
        },
    };

    const userProfile = await getFromDb(getRequest);

    if (userProfile === undefined) {
        throw new Error("USER_NOT_FOUND");
    }

    return userProfile;
}

/**
 * Décrémente atomiquement le compteur useRemaining du refresh token en DynamoDB.
 *
 * La condition DynamoDB garantit que l'opération échoue si :
 *   - Le token n'existe pas en base (PK absent)
 *   - Le compteur useRemaining est déjà à 0 (token épuisé)
 *   - Le token est expiré en base (expiredAt dépassé)
 *
 * En cas d'échec de condition → ConditionalCheckFailedException → 401 dans le handler.
 *
 * @param {string} refreshTokenHash - Hash SHA-256 du refresh token (clé de partition)
 * @returns {Promise<{ useRemaining: number }>}
 */
async function decrementRefreshTokenUsage(refreshTokenHash) {
    const updateRequest = {
        TableName: TOKEN_TABLE,
        Key: {
            PK: refreshTokenHash,
            SK: "REFRESH",
        },
        UpdateExpression: "SET useRemaining = useRemaining - :decrement",
        ExpressionAttributeValues: {
            ":decrement": 1,
            ":now": Math.floor(Date.now() / 1000),
            ":zero": 0,
        },
        ConditionExpression: "attribute_exists(PK) AND useRemaining > :zero AND expiredAt > :now",
        ReturnValues: "UPDATED_NEW",
    };

    return await sendUpdateToDb(updateRequest);
}
