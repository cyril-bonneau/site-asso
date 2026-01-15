import { getFromDb } from "../dal/requestToDb.js";

const USER_TABLE = process.env.USER_TABLE;

export async function getEmailByUserId(userId) {
    try {
        const Item = await getFromDb({
            TableName: USER_TABLE,
            Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
            ProjectionExpression: "email, firstName, lastName",
        })
        return Item
    } catch (err) {
        return err
    }
}