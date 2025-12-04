import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
    DynamoDBDocumentClient,
    GetCommand
} from "@aws-sdk/lib-dynamodb";

const USER_TABLE = "site-asso-dev-asso-main";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

export async function getUserProfileByUserId(userId) {
    try {
        const res = await ddb.send(
            new GetCommand({
                TableName: USER_TABLE,
                Key: {
                    PK: `USER#${userId}`,
                    SK: `PROFILE#${userId}`
                },
                ProjectionExpression: "lastName, firstName, email",
            })
        )
        console.log("getUserProfileByUserId result:", res);
        return res.Item;
    } catch (err) {
        console.error("getUserProfileByUserId error", err)
        return undefined;
    }
}