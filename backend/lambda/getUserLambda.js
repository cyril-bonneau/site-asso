import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.DDB_TABLE;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

const userCommand = new GetCommand({
    TableName: TABLE,
    Key: {
        PK: `USER#${id}`,
        SK: `PROFILE#${id}`
    },
    ProjectionExpression: "email, firstName, lastName, updatedAt",
})

export const handler = async (event) => {
    try {
        const data = JSON.parse(event.body);
        if (data?.userId) {

        }
        console.log("Received data:", data);
        const email = String(data.email).trim().toLowerCase();



        //     const command = new GetCommand({
        //         TableName: TABLE,
        //         Key: {
        //             PK: `EMAIL#${email}`,
        //             SK: "UNIQUE"
        //         },
        //         // ProjectionExpression: "name, familyName",
        //         // ConsistentRead: false
        //     })

        //     const getId = await ddb.send(command);

        //     const id = getId.Item?.userId;

        //     const userCommand = new GetCommand({
        //         TableName: TABLE,
        //         Key: {
        //             PK: `USER#${id}`,
        //             SK: `PROFILE#${id}`
        //         },
        //         ProjectionExpression: "email, firstName, lastName, updatedAt",
        //     })

        //     const result = await ddb.send(userCommand);

        //     return json(201, { ok: true, message: "User data retrieved successfully", data: result.Item });

    } catch (err) {
        console.error("Error in getUserData handler:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    }
}

export async function getUserId(data) {
    try {
        if (data?.userId) {

        }
        console.log("Received data:", data);
        const email = String(data.email).trim().toLowerCase();

        const command = new GetCommand({
            TableName: TABLE,
            Key: {
                PK: `EMAIL#${email}`,
                SK: "UNIQUE"
            },
            // ProjectionExpression: "name, familyName",
            // ConsistentRead: false
        })

        const getId = await ddb.send(command);

        return json(201, { ok: true, message: "User data retrieved successfully", data: getId.Item?.userId });

    } catch (err) {
        console.error("Error in getUserData handler:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "INTERNAL_ERROR" }),
        };
    }
}

export async function getUserDataById(id) {
    try {
        const id = getId.Item?.userId;

        const userCommand = new GetCommand({
            TableName: TABLE,
            Key: {
                PK: `USER#${id}`,
                SK: `PROFILE#${id}`
            },
            ProjectionExpression: "email, firstName, lastName, updatedAt",
        })

        const result = await ddb.send(userCommand);

        return json(201, { ok: true, message: "User data retrieved successfully", data: result.Item });

    } catch (err) {
        console.error("Error in getUserDataById:", err);
        throw err;
    }
}

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}