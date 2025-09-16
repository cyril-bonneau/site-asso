const { SignJWT, jwtVerify, decodeJwt } = require('jose');
const argon2 = require('argon2');
const crypto = require('crypto');
const { loadAllKeys } = require('./key');

const ACCESS_TTL = process.env.ACCESS_TTL || '15m';
const REFRESH_TTL = process.env.REFRESH_TTL || '7d';

let ALG, accessKeys, refreshKeys;

async function initKeys() {
    const loaded = await loadAllKeys();
    ALG = loaded.ALG;
    accessKeys = loaded.access;
    refreshKeys = loaded.refresh;
}

async function signAccessToken(user) {
    return await new SignJWT({ sub: String(user) })
        .setProtectedHeader({ alg: ALG })
        .setExpirationTime(ACCESS_TTL)
        .sign(accessKeys.privateKey);
}

async function signRefreshToken(user, jti) {
    return await new SignJWT({ sub: String(user), jti })
        .setProtectedHeader({ alg: ALG })
        .setExpirationTime(REFRESH_TTL)
        .sign(refreshKeys.privateKey);
}

async function verifyAccessToken(token) {
    const { payload } = await jwtVerify(token, accessKeys.publicKey, { algorithms: [ALG] });
    return payload;
}

async function verifyRefreshToken(token) {
    const { payload } = await jwtVerify(token, refreshKeys.publicKey, { algorithms: [ALG] });
    return payload;
}

function decodeRefreshExpSeconds(token) {
    const payload = decodeJwt(token);
    return payload.exp;
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(pwd) {
    return argon2.hash(pwd, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
    });
}

async function verifyPassword(hash, pwd) {
    return argon2.verify(hash, pwd);
}

module.exports = {
    initKeys,
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken,
    decodeRefreshExpSeconds,
    hashToken,
    hashPassword,
    verifyPassword,
};