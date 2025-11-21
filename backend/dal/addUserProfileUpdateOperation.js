const USER_TABLE = process.env.USER_TABLE;

export function addUserProfileUpdateOperation({ userId, firstName, lastName, }) {
    const exprNames = {
        "#updatedAt": "updatedAt",
    };

    const exprValues = {
        ":updatedAt": new Date().toISOString(),
    };

    let updateExpr = "SET #updatedAt = :updatedAt";

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
    return [{
        Update: {
            TableName: USER_TABLE,
            Key: { PK: `USER#${userId}`, SK: `PROFILE#${userId}` },
            UpdateExpression: updateExpr,
            ExpressionAttributeNames: exprNames,
            ExpressionAttributeValues: exprValues,
            ConditionExpression: "attribute_exists(PK)",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
        }
    }]
}