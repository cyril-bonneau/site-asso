/**
 * Builds the two-item DynamoDB transaction written when an auth entry is created
 * during registration.
 *
 * Pure: no environment access, no AWS client, no clock of its own. Every
 * nondeterministic input arrives as a parameter so the item contract can be
 * asserted without mocking AWS.
 *
 * The two `expiredAt` values are computed by two separate calls to
 * `currentEpochMillisecondsProvider`, exactly as the inlined code did. They are
 * deliberately NOT hoisted into a single shared value: collapsing them would
 * change behavior at a second boundary.
 *
 * @param {object} args
 * @param {string} args.email                    normalized email address
 * @param {string} args.hashedPassword           argon2 hash of the submitted password
 * @param {string} args.generatedUserId          raw generated id, without the `USER#` prefix
 * @param {string} args.createdAtIsoTimestamp    ISO 8601 creation timestamp
 * @param {string} args.authTableName            target DynamoDB table
 * @param {() => number} [args.currentEpochMillisecondsProvider]  defaults to Date.now
 * @returns {Array<object>} TransactItems, index 0 = user record, index 1 = email uniqueness record
 */
export function buildRegisterAuthTransactionItems({
    email,
    hashedPassword,
    generatedUserId,
    createdAtIsoTimestamp,
    authTableName,
    currentEpochMillisecondsProvider = Date.now,
}) {
    const userEmail = `EMAIL#${email}`;
    const userId = `USER#${generatedUserId}`;

    return [
        {
            Put: {
                TableName: authTableName,
                Item: {
                    PK: userId,
                    SK: "AUTH",
                    userId: generatedUserId,
                    email: email,
                    passwordHash: hashedPassword,
                    createdAt: createdAtIsoTimestamp,
                    expiredAt: Math.floor(currentEpochMillisecondsProvider() / 1000) + (24 * 60 * 60), // 24h
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        },
        {
            Put: {
                TableName: authTableName,
                Item: {
                    PK: userEmail,
                    SK: "UNIQUE",
                    userId: userId,
                    validated: false,
                    createdAt: createdAtIsoTimestamp,
                    expiredAt: Math.floor(currentEpochMillisecondsProvider() / 1000) + (24 * 60 * 60), // 24h
                },
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            }
        }
    ];
}
