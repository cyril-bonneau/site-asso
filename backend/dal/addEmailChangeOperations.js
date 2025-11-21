const AUTH_TABLE = process.env.AUTH_TABLE;
const USER_TABLE = process.env.USER_TABLE;;

export function addEmailChangeOperations({ userId, oldEmail, newEmail }) {

    return [{
        Delete: {
            TableName: AUTH_TABLE,
            Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
        },
    },
    {
        Delete: {
            TableName: USER_TABLE,
            Key: { PK: `EMAIL#${oldEmail}`, SK: "UNIQUE" },
        },
    },
    {
        Put: {
            TableName: AUTH_TABLE,
            Item: {
                PK: `EMAIL#${newEmail}`,
                SK: "UNIQUE",
                userId: `USER#${userId}`,
                createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
    },
    {
        Put: {
            TableName: USER_TABLE,
            Item: {
                PK: `EMAIL#${newEmail}`,
                SK: "UNIQUE",
                userId,
                GSI1SK: newEmail,
                createdAt: new Date().toISOString(),
            },
            ConditionExpression: "attribute_not_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
    },
    {
        Update: {
            TableName: AUTH_TABLE,
            Key: { PK: `USER#${userId}`, SK: "AUTH" },
            UpdateExpression:
                "SET #email = :email, #GSI1PK = :GSI1PK, #updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#email": "email",
                "#GSI1PK": "GSI1PK",
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":email": newEmail,
                ":GSI1PK": `EMAIL#${newEmail}`,
                ":updatedAt": new Date().toISOString(),
            },
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        },
    },
    {
        Update: {
            TableName: USER_TABLE,
            Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
            UpdateExpression:
                "SET #email = :email, #GSI1SK = :GSI1SK, #updatedAt = :updatedAt",
            ExpressionAttributeNames: {
                "#email": "email",
                "#GSI1SK": "GSI1SK",
                "#updatedAt": "updatedAt",
            },
            ExpressionAttributeValues: {
                ":email": newEmail,
                ":GSI1SK": newEmail,
                ":updatedAt": new Date().toISOString(),
            }
        }
    }]
}
