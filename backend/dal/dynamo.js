import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ddbDocClient } from "./client.js";
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { nanoid } from 'nanoid';

export const table = process.env.USER_TABLE;              // vient de serverless.api.yml
const ddb = new DynamoDBClient({});                      // region/creds via rôle Lambda
export const doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true }
});

// Petit ping: Put -> Get -> Delete
export async function pingDdb() {
    const key = { PK: 'PING', SK: `PING#${Date.now()}` };
    await doc.send(new PutCommand({
        TableName: table,
        Item: { ...key, TTL: Math.floor(Date.now() / 1000) + 60 }
    }));
    const { Item } = await doc.send(new GetCommand({ TableName: table, Key: key }));
    await doc.send(new DeleteCommand({ TableName: table, Key: key }));
    return { ok: !!Item };
}

export async function getUserByEmail(email) {
    const params = {
        TableName: process.env.MAIN_TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: "GSI1PK = :email",
        ExpressionAttributeValues: {
            ":email": `EMAIL#${email}`
        },
        Limit: 1
    }

    try {
        const res = await ddbDocClient.send(new QueryCommand(params));
        return res.Items?.[0] || null;
    } catch (error) {
        console.error("Error in getUserByEmail", error);
        throw error;
    }
}

export async function insertUser(user) {
    const id = nanoid();
    const key = {
        PK: `USER#${id}`,
        SK: 'PROFILE',
        field: [
            { gsi1pk: `UNIQUE#EMAIL#${user.email}` },
            { gsi1sk: `USER#${id}` },
            { name: user.name },
            { familyName: user.familyName },
            { createdAt: new Date().toISOString() },
            { updatedAt: new Date().toISOString(), }
        ]
    };
    const checking = await getUserByEmail(user.email)
    if (checking) return console.log("User already exists with this email");
    const result = await doc.send(new PutCommand({
        TableName: table,
        Item: { ...key }
    }));
    return result;

    // il faut encore rajouter dans la route dans le index.js la whitelist et rajouter la route dans le dossier route de backend
    // c'est pas très compliqué, regarde comment j'ai fait pour le getUserByEmail.js (c'est ce que gtp appel l'étape 3C)
}