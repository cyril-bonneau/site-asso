// backend/rateLimit/rateLimitStorageDdb.js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddbDefault = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function getDefaultDdb() {
    return ddbDefault;
}

export function buildRateLimitKey(scope, key) {
    return `RL#${scope}#${key}`;
}

/**
 * Charge l'item de rate-limit en DB.
 */
export async function loadBucket({ ddb = ddbDefault, tableName, pk }) {
    const res = await ddb.send(
        new GetCommand({
            TableName: tableName,
            Key: { PK: pk }
        })
    );
    return res.Item || null;
}

/**
 * Sauvegarde l'état du seau en DB.
 */
export async function saveBucket({ ddb = ddbDefault, tableName, pk, tokens, nowSec, ttlSeconds }) {
    const ttl = nowSec + (ttlSeconds ?? 86400);

    await ddb.send(
        new UpdateCommand({
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
            // Si tu veux re-mettre une condition stricte de création uniquement : 
            // ConditionExpression: "attribute_not_exists(#ver)",
        })
    );
}

// Petit export pratique pour les tests éventuels (facultatif)
export const __test = { buildRateLimitKey };
