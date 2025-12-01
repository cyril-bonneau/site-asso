import { ddb, sendUpdateToDb, getFromDb } from "../dal/requestToDb.js";

export function getDefaultDdb() {
    return ddb;
}

export function buildRateLimitKey(scope, key) {
    return `RL#${scope}#${key}`;
}

/**
 * Charge l'item de rate-limit en DB.
 */
export async function loadBucket({ tableName, pk }) {

    const item = await getFromDb({
        TableName: tableName,
        Key: { PK: pk }
    })
    return item || null;
}

/**
 * Sauvegarde l'état du seau en DB.
 */
export async function saveBucket({ tableName, pk, tokens, nowSec, ttlSeconds }) {
    const ttl = nowSec + (ttlSeconds ?? 86400);

    await sendUpdateToDb({
        TableName: tableName,
        Key: { PK: pk },
        UpdateExpression: "SET #tokens = :tokens, #win = :win, #ver = :ver, #ttl = :ttl",
        ExpressionAttributeNames: {
            "#tokens": "tokens",
            "#win": "windowStartedAt",
            "#ver": "ver",
            "#ttl": "TTL"
        },
        ExpressionAttributeValues: {
            ":tokens": tokens,
            ":win": nowSec,
            ":ver": 1,
            ":ttl": ttl
        }
    })
}

// Petit export pratique pour les tests éventuels (facultatif)
export const __test = { buildRateLimitKey };
