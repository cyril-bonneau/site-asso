import { sendPutToDb } from "./requestToDb.js";

const TOKEN_TABLE = process.env.TOKEN_TABLE;

export async function storeRefreshToken(hashedRefreshToken, userId) {
    const params = {
        TableName: TOKEN_TABLE,
        Item: {
            PK: hashedRefreshToken,
            SK: 'REFRESH',
            userId: userId,
            createdAt: new Date().toISOString(),
            expiredAt: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 jours
        }
    }
    try {
        const result = await sendPutToDb(params);
        console.log("storeRefreshToken: successfully stored refresh token", result);
        return result;
    } catch (err) {
        console.error("storeRefreshToken: error storing refresh token", err);
        throw err;
    }
}