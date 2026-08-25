/**
 * Builds the DynamoDB Put parameters for the email-validation token record written
 * during registration.
 *
 * Pure: no environment access, no AWS client. The two timestamps are produced by
 * injectable providers whose defaults reproduce the original inlined expressions, and
 * they are evaluated in the same order as before — createdAt first, then expiredAt.
 *
 * @param {object} args
 * @param {{validationToken: string}} args.rawToken   the generated validation token
 * @param {string} args.userId                        raw user id, without the `USER#` prefix
 * @param {string} args.accountValidationTableName    target DynamoDB table
 * @param {() => string} [args.currentIsoTimestampProvider]       defaults to new Date().toISOString()
 * @param {() => number} [args.currentEpochMillisecondsProvider]  defaults to Date.now
 * @returns {object} PutCommand input
 */
export function buildAccountValidationTokenItem({
    rawToken,
    userId,
    accountValidationTableName,
    currentIsoTimestampProvider = () => new Date().toISOString(),
    currentEpochMillisecondsProvider = Date.now,
}) {
    return {
        TableName: accountValidationTableName,
        Item: {
            PK: rawToken.validationToken,
            SK: 'EMAIL_VALIDATION',
            userId: userId,
            createdAt: currentIsoTimestampProvider(),
            expiredAt: Math.floor(currentEpochMillisecondsProvider() / 1000) + (24 * 60 * 60), // 24h
        }
    };
}
