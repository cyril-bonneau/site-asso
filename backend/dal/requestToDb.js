import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    TransactWriteCommand,
    UpdateCommand,
    DeleteCommand,
    GetCommand
} from "@aws-sdk/lib-dynamodb";

const USER_TABLE = "site-asso-dev-asso-main";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function sendTransactToDb(transactItems, CancellationReasons) {
    try {
        await ddb.send(
            new TransactWriteCommand({
                TransactItems: transactItems,
                ReturnCancellationReasons: CancellationReasons || false,
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
        console.error("update failed", err)
        throw err
    }
}

export async function removeFromDb(removeRequest) {
    try {
        await ddb.send(new DeleteCommand(removeRequest))
    } catch (err) {
        console.log("error while removing data", err)
        throw err
    }
}

export async function getUserProfileByUserId(userId) {
    try {
        const { Item } = await ddb.send(
            new GetCommand({
                TableName: USER_TABLE,
                Key: {
                    PK: `USER#${userId}`,
                    SK: `PROFILE#${userId}`
                },
                ProjectionExpression: "lastName, firstName, email",
            })
        )
        console.log("getUserProfileByUserId result", Item)
        return Item;
    } catch (err) {
        console.error("getUserProfileByUserId error", err)
        return undefined;
    }
}