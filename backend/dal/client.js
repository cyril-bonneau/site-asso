// backend/dal/client.js
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
    region: process.env.PROJECT_AWS_REGION || "eu-west-3", // Paris par défaut
    maxAttempts: 3,
});

// On enveloppe le client dans le DocumentClient pour travailler avec
// des objets JS natifs (sans marshall/unmarshall manuel)
export const ddbDocClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: {
        removeUndefinedValues: true,
    },
    unmarshallOptions: {
        wrapNumbers: false,
    },
});
