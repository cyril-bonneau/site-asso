const AUTH_TABLE = process.env.AUTH_TABLE;
const USER_TABLE = process.env.USER_TABLE;

export function addUserProfileUpdateOperation({ userId,
    firstName,
    lastName,
    newEmail,
    oldEmail,
    hasEmailChange,
    hasProfileChange }) {

    const exprNames = {
        "#updatedAt": "updatedAt",
    };

    const exprValues = {
        ":updatedAt": new Date().toISOString(),
    };

    let updateExpr = "SET #updatedAt = :updatedAt";

    const transact = []

    if (hasEmailChange) {

        transact.push(
            {
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
            }
        )
    }

    if (hasProfileChange || hasEmailChange) {
        if (firstName !== undefined) {
            exprNames["#firstName"] = "firstName";
            exprValues[":firstName"] = firstName;
            updateExpr += ", #firstName = :firstName";
        }

        if (lastName !== undefined) {
            exprNames["#lastName"] = "lastName";
            exprValues[":lastName"] = lastName;
            updateExpr += ", #lastName = :lastName";
        }

        if (hasEmailChange) {
            exprNames["#email"] = "email";
            exprNames["#GSI1SK"] = "GSI1SK";
            exprValues[":email"] = newEmail;
            exprValues[":GSI1SK"] = newEmail;
            updateExpr += ", #email = :email, #GSI1SK = :GSI1SK";
        }

        transact.push({
            Update: {
                TableName: USER_TABLE,
                Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
                UpdateExpression: updateExpr,
                ExpressionAttributeNames: exprNames,
                ExpressionAttributeValues: exprValues,
                ConditionExpression: "attribute_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            }
        })
    }

    return transact
}