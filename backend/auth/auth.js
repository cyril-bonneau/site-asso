import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import argon2 from 'argon2';
import crypto from 'crypto';
import { loadAllKeys } from './key.js';

const ACCESS_TTL = process.env.ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.REFRESH_TTL || '7d';

let ALG, accessKeys, refreshKeys;

export async function initKeys() {
    const loaded = await loadAllKeys();
    ALG = loaded.ALG;
    accessKeys = loaded.access;
    refreshKeys = loaded.refresh;
}

export async function signAccessToken(user) {
    return await new SignJWT({ sub: String(user) })
        .setProtectedHeader({ alg: ALG })
        .setExpirationTime(ACCESS_TTL)
        .sign(accessKeys.privateKey);
}

export async function signRefreshToken(user, jti) {
    return await new SignJWT({ sub: String(user), jti })
        .setProtectedHeader({ alg: ALG })
        .setExpirationTime(REFRESH_TTL)
        .sign(refreshKeys.privateKey);
}

export async function getAccessTokenData(token) {
    const { payload } = await jwtVerify(token, accessKeys.publicKey, { algorithms: [ALG] });
    return payload;
}

export async function getRefreshTokenData(token) {
    const { payload } = await jwtVerify(token, refreshKeys.publicKey, { algorithms: [ALG] });
    return payload;
}

export function decodeRefreshExpSeconds(token) {
    const payload = decodeJwt(token);
    return payload.exp;
}

export function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(pwd) {
    return argon2.hash(pwd, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
    });
}

export async function verifyPassword(hash, pwd) {
    return argon2.verify(hash, pwd);
}