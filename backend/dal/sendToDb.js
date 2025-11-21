import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    TransactWriteCommand,
    UpdateCommand
} from "@aws-sdk/lib-dynamodb";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function sendTransactToDb(transactItems) {
    try {
        await ddb.send(
            new TransactWriteCommand({
                TransactItems: transactItems,
                ReturnConsumedCapacity: "TOTAL",
            })
        );
    } catch (err) {
        console.error("DDB TRANSACT ERROR:", err)
        throw err
    }
}

export async function sendUpdateToDb(updatePasswordResult) {
    try {
        await ddb.send(new UpdateCommand(updatePasswordResult))
    } catch (err) {
        throw err
    }
}