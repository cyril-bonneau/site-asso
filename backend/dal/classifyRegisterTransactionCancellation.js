/**
 * Classifies a DynamoDB TransactionCanceledException raised while creating an auth
 * entry during registration.
 *
 * Deterministic and dependency-free: no environment, no AWS client, no clock. It does
 * emit the same console.info calls the inlined code emitted, in the same order, because
 * that log sequence is part of the flow's observable operational behavior.
 *
 * BEHAVIOR NOTE — preserved deliberately, do not "correct" here:
 * index 0 of the transaction is the USER# record and index 1 is the EMAIL# record, but
 * index 0 is bound to `emailCheck` and index 1 to `checkId`. A genuine duplicate email
 * therefore classifies as ID_COLLISION, not EMAIL_ALREADY_EXISTS. This mapping is
 * reproduced exactly as it was written. Changing it is a behavior change and requires a
 * separate, explicitly authorized task.
 *
 * @param {Array<{Code?: string, Message?: string}>} cancellationReasons  err.CancellationReasons
 * @param {Array<object>} transaction  the TransactItems the cancelled request carried
 * @returns {string} one of REGISTER_CANCELLATION_OUTCOME
 */
export const REGISTER_CANCELLATION_OUTCOME = {
    EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
    ID_COLLISION: "ID_COLLISION",
    UNCLASSIFIED: "UNCLASSIFIED",
};

export function classifyRegisterTransactionCancellation(cancellationReasons, transaction) {
    const reasons = cancellationReasons.map((r, i) => ({
        index: i,
        opType: Object.keys(transaction[i])[0],
        code: r.Code,
        message: r.Message,
    }));
    console.info("createAuthEntry cancellation reasons", reasons)

    const emailCheck = reasons.find(r => r.index === 0);
    console.info("emailCheck", emailCheck)

    if (emailCheck && emailCheck.code === "ConditionalCheckFailed") {
        return REGISTER_CANCELLATION_OUTCOME.EMAIL_ALREADY_EXISTS;
    }

    const checkId = reasons.find(r => r.index === 1);
    console.info("checkId", checkId)

    if (checkId && checkId.code === "ConditionalCheckFailed") {
        return REGISTER_CANCELLATION_OUTCOME.ID_COLLISION;
    }

    return REGISTER_CANCELLATION_OUTCOME.UNCLASSIFIED;
}
