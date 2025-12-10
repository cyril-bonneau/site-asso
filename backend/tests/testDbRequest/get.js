import { ddb } from "../../dal/requestToDb.js";
import {
    GetCommand
} from "@aws-sdk/lib-dynamodb";

const USER_TABLE = `site-asso-${process.env.STAGE}-asso-main`;

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