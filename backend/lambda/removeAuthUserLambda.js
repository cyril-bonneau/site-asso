import {
    DynamoDBClient
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";

import { checkPasswordByUserId } from "../dal/checkPasswordByUserId.js";
import { json } from "../helpers/json";

const AUTH_TABLE = process.env.AUTH_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export const handler = async (event) => {
    let data
    try {
        data = JSON.parse(event.body)
    } catch (err) {
        return json(400, { ok: false, message: "INVALID_JSON_BODY" })
    }
    const { email, password, id } = data

    if (!email || !password || !id) {
        return json(400, { ok: false, message: "MISSING_CRUCIAL_DATA" })
    }

    if (!email) {
        return json(400, { ok: false, error: "EMAIL_REQUIRED" });
    }

    const result = await removeAuthUser(id, email, password)
    return json(201, { ok: true, message: "User removed", ...result });
}

async function removeAuthUser(userId, email, password) {

    console.log('test')
    const pkAuth = `USER#${userId}`
    const skAuth = "AUTH"
    const pkEmail = `EMAIL#${email}`
    const skEmail = "UNIQUE"

    const test = await checkPasswordByUserId({ password, userId })

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