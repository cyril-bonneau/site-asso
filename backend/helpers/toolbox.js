import crypto from "crypto";
import { SignJWT } from "jose/jwt/sign";

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

    const maxAgeSec = 10 * 24 * 60 * 60; // 10 jours
    const securePart = isProd ? " Secure;" : "";
    const sameSite = "Lax"; // ou Strict si tu veux être super strict

    return `refreshToken=${refreshToken}; HttpOnly;${securePart} SameSite=${sameSite}; Path=/; Max-Age=${maxAgeSec}`;
}

// algo must be HS256 or other symmetric algorithm
export async function generateRefreshToken(userId, REFRESH_JWT_HMAC) {
    const nowSec = Math.floor(Date.now() / 1000);
    const refreshTokenPayload = {
        userId: userId,
        // issuer: "site-asso/api",
        // audience: "site-asso/frontend",
        issuedAt: nowSec,
        expiredAt: nowSec + (10 * 24 * 60 * 60) // 10 jours
    };
    const refreshToken = await new SignJWT(refreshTokenPayload)
        .setProtectedHeader({ alg: "HS256" })
        .sign(REFRESH_JWT_HMAC);
    return refreshToken;
}

export function currentDateFr() {
    return Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

export function sanitizeText(input, opts = {}) {
    const {
        maxLength = 200,
        allowNewLines = false,
        fallback = "",
    } = opts;

    if (typeof input !== "string") return fallback;

    let value = input
        .normalize("NFKC") // Normalisation Unicode
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .replace(/</g, "")
        .replace(/>/g, "")
        .replace(/["'`]/g, "");

    if (!allowNewLines) {
        value = value.replace(/\r?\n|\r/g, " ");
    }

    return value.trim().slice(0, maxLength);
}