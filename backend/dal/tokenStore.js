import { sendPutToDb, sendTransactToDb } from "./requestToDb.js";
import { currentDateFr } from "../helpers/toolbox.js";

const TOKEN_TABLE = process.env.TOKEN_TABLE;

export async function storeRefreshToken(hashedRefreshToken, userId, oldHashedToken) {
    const lastConnexionDate = currentDateFr();
    if (oldHashedToken) {
        const transact = []
        transact.push({
            Delete: {
                TableName: TOKEN_TABLE,
                Key: {
                    PK: oldHashedToken,
                    SK: 'REFRESH',
                },
                ConditionExpression: "attribute_exists(PK)"
            }
        })
        transact.push({
            Put: {
                TableName: TOKEN_TABLE,
                Item: {
                    PK: hashedRefreshToken,
                    SK: 'REFRESH',
                    userId: userId,
                    createdAt: new Date().toISOString(),
                    lastConnexionDate: lastConnexionDate,
                    useRemaining: 3,
                    expiredAt: Math.floor(Date.now() / 1000) + (10 * 24 * 60 * 60), // 10 jours
                },
                ConditionExpression: "attribute_not_exists(PK)"
            }
        })
        try {
            await sendTransactToDb(transact);
            console.log("storeRefreshToken: successfully stored refresh token with old token removal");
            return;
        } catch (err) {
            console.error("storeRefreshToken: error storing refresh token", err);
            throw new Error("STORE_REFRESH_TOKEN_TRANSACT_FAILED");
        }
    } else {
        const params = {
            TableName: TOKEN_TABLE,
            Item: {
                PK: hashedRefreshToken,
                SK: 'REFRESH',
                userId: userId,
                createdAt: new Date().toISOString(),
                lastConnexionDate: lastConnexionDate,
                useRemaining: 3,
                expiredAt: Math.floor(Date.now() / 1000) + (10 * 24 * 60 * 60), // 10 jours
            }
        }
        try {
            const result = await sendPutToDb(params);
            console.log("storeRefreshToken: successfully stored refresh token", result);
            return result;
        } catch (err) {
            console.error("storeRefreshToken: error storing refresh token", err);
            throw new Error("STORE_REFRESH_TOKEN_FAILED");
        }
    }
}