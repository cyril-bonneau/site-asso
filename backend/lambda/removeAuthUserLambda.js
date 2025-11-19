import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { checkPassword } from "../helpers/checkPassword";

const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export const handler = async (event) => {
    const { email, password, id } = JSON.parse(event.body)

    if (!email) {
        return json(400, { ok: false, error: "EMAIL_REQUIRED" });
    }

    const result = await removeAuthUser(id, email, password)
    return json(201, { ok: true, message: "User removed", ...result });
}

async function removeAuthUser(id, email, password) {

    console.log('test')
    const pkAuth = `USER#${id}`
    const skAuth = "AUTH"
    const pkEmail = `EMAIL#${email}`
    const skEmail = "UNIQUE"

    const test = await checkPassword({ password, id })

    if (!test) {
        const err = new Error("Wrong password");
        err.code = "WRONG_PASSWORD";
        throw err;
    }

    const cmd = new TransactWriteCommand({
        TransactItems: [
            {
                Delete: {
                    TableName: AUTH_TABLE,
                    Key: { PK: pkAuth, SK: skAuth },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
                },
            },
            {
                Delete: {
                    TableName: AUTH_TABLE,
                    Key: { PK: pkEmail, SK: skEmail },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
                }
            }
        ],
        ReturnConsumedCapacity: "TOTAL",
    })

    try {
        return await ddb.send(cmd)
    } catch (err) {
        throw err
    }
}

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}