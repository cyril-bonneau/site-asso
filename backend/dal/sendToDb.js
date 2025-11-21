import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    TransactWriteCommand
} from "@aws-sdk/lib-dynamodb";

import { json } from "../helpers/json.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function sendToDb(transactItems) {
    try {
        await ddb.send(
            new TransactWriteCommand({
                TransactItems: transactItems,
                ReturnConsumedCapacity: "TOTAL",
            })
        );
    } catch (err) {
        return json(err.statusCode, { ok: false, message: err.message })
    }
}