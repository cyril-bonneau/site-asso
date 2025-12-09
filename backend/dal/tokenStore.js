import { sendPutToDb } from "./requestToDb.js";

const TOKEN_TABLE = process.env.TOKEN_TABLE;

export async function storeRefreshToken(hashedRefreshToken, userId) {
    const params = {
        TableName: process.env.TOKEN_TABLE,
        Item: {
            PK: hashedRefreshToken,
            SK: 'REFRESH',
            userId: userId,
            createdAt: new Date().toISOString(),
            expiredAt: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 jours
        }
    }
    try {
        return await sendPutToDb(params);
    } catch (err) {
        console.error("storeRefreshToken: error storing refresh token", err);
        throw err;
    }
}