import {
    DynamoDBClient,
    TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

const TABLE = process.env.DDB_TABLE;
const ddb = new DynamoDBClient({});

export async function updateUser(data) {
    const userId = data.pathParameters.userId;
    const { newEmail, firstName, lastName } = data ?? {};

    await lambda.send(new InvokeCommand({
        FunctionName: 'arn:aws:lambda:eu-west-3:011664843444:function:site-asso-api-dev-getUser',
        InvocationType: 'Event',
        Payload: JSON.stringify({ userId: userId }),
    }));

    if (!newEmail) {
        const params = {
            TableName: TABLE,
            Key: {
                PK: { S: `USER#${userId}` },
                SK: { S: `PROFILE` },
            },
            UpdateExpression: `SET #firstName = :firstName, #familyName = :familyName, #updatedAt = :updatedAt`,
            ExpressionAttributeNames: {
                "#firstName": "firstName",
                "#familyName": "familyName",
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":displayName": firstName,
                ":familyName": lastName,
                ":updatedAt": new Date().toISOString(),
            },
            ReturnValues: "ALL_NEW",
        }
    }
}