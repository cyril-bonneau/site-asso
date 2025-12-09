import crypto from "crypto";
import { jwtSign } from "jose/jwt/sign";

export function normalizeEmail(email) {
    return String(email).trim().toLowerCase();
}

export function decode(payload) {
    const decoder = new TextDecoder("utf-8");
    const payloadString = decoder.decode(payload);
    let response = JSON.parse(payloadString);
    return {
        ...response,
        body: JSON.parse(response.body)
    };
}

export function json(statusCode, body, headers = undefined) {
    return {
        statusCode,
        headers: {
            "content-type": "application/json",
            ...(headers ?? {}),
        },
        body: JSON.stringify(body ?? {}),
    };
}

export function toBase64Url(buffer) {
    return Buffer.from(buffer)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

export function hashRefreshToken(refreshToken) {
    return crypto
        .createHash('sha256')
        .update(refreshToken)
        .digest('hex');
}

export function buildRefreshCookie(refreshToken) {
    const stage = process.env.STAGE || "dev";
    const isProd = stage === "prod";

    const maxAgeSec = 30 * 24 * 60 * 60; // 30 jours
    const securePart = isProd ? " Secure;" : "";
    const sameSite = "Lax"; // ou Strict si tu veux être super strict

    return `refreshToken=${refreshToken}; HttpOnly;${securePart} SameSite=${sameSite}; Path=/; Max-Age=${maxAgeSec}`;
}

export function generateRefreshToken(userId) {
    const nowSec = Math.floor(Date.now() / 1000);
    const refreshTokenPayload = {
        userId: userId,
        // issuer: "site-asso/api",
        // audience: "site-asso/frontend",
        issuedAt: nowSec,
        expiredAt: nowSec + (30 * 24 * 60 * 60) // 30 jours
    };
    const refreshToken = jwtSign(refreshTokenPayload, REFRESH_JWT_HMAC);
    return refreshToken;
}