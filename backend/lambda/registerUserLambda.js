import { nanoid } from "nanoid";
import { randomBytes } from "node:crypto";
import { validatePasswordBackend } from "../auth/passwordPolicy.js";
import { withRateLimit } from "../rateLimit/withRateLimit.js";
import { hashPassword } from "../auth/auth.js";
import { json } from "../helpers/toolbox.js";
import { sendTransactToDb, sendPutToDb } from "../dal/requestToDb.js";
import { eventBridgePutEvents } from "../eventBridge/registerEventBus.js";
import { validateInput } from "../zod/validateInput.js";
import { registerInputSchema } from "../zod/zodSchema/registerInputValidation.js";
import { buildRegisterAuthTransactionItems } from "../dal/buildRegisterAuthTransactionItems.js";
import { classifyRegisterTransactionCancellation, REGISTER_CANCELLATION_OUTCOME } from "../dal/classifyRegisterTransactionCancellation.js";
import { buildAccountValidationTokenItem } from "../dal/buildAccountValidationTokenItem.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const EVENT_BUS_NAME = process.env.REGISTER_EVENT_BUS;
const ACCOUNT_VALIDATION_TABLE = process.env.ACCOUNT_VALIDATION_TABLE;

// event must contain email, password in body

export const handler = withRateLimit(registerUserCore, {
    scope: "REGISTER",     // nom logique de l’action
    capacity: 3,
    refillRate: 0.1,       // 1 token / 10 s
    cost: 1
})

async function registerUserCore(event) {
    let input;
    try {
        console.info("registerUserCore event:", event);
        input = validateInput(event, registerInputSchema);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }
    } catch (err) {
        console.error("registerUserCore error during input validation", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }

    const { email, password, firstName, lastName } = input.body.data;
    const privilege = ["USER"];
    try {
        const check = await validatePasswordBackend(password, {
            email,
            // username: data.username,
            useHIBP: true // ou false si tu veux éviter l'appel externe
        });

        if (!check.ok) {
            return json(422, { ok: false, code: "WEAK_PASSWORD", reasons: check.reasons });
        }

        const res = await createAuthEntry(email, password);

        if (res.error === "EMAIL_ALREADY_EXISTS") {
            return json(409, { ok: false, message: "EMAIL_ALREADY_EXISTS" })
        } else if (res.statusCode !== 201) {
            return json(res.statusCode || 500, { ok: false, message: res.error || "INTERNAL_ERROR" })
        }

        const userId = res.userId;

        // il est attendu au minimum userId, email, firstName, lastName
        const detail = { email, firstName, lastName, userId, privilege };
        const rawToken = { validationToken: randomBytes(32).toString("base64url") }
        const eventEntry = buildUserRegisterEvent(detail, "UserRegistered");

        try {
            const putTokenToDb = await createTokenEntry(rawToken, userId);
            console.log("registerUserCore - createTokenEntry result:", putTokenToDb);
        } catch (err) {
            console.error("registerUserCore: error creating token entry in DB", err);
            return json(500, { ok: false, message: "INTERNAL_ERROR" });
        }

        const emailValidationEvent = buildUserRegisterEvent(rawToken, "emailValidation");

        const resultEvent = await eventBridgePutEvents(eventEntry);
        const emailValidationResult = await eventBridgePutEvents(emailValidationEvent);

        if (!resultEvent.FailedEntryCount && !emailValidationResult.FailedEntryCount) {
            return json(
                201,
                {
                    ok: true,
                    userId: userId,
                    message: res.message
                }
            );
        }
        console.warn("registerUserCore: error in refreshTokenPart", { err });
        console.error("registerUserCore: eventBridgePutEvents failed", {
            FailedEntryCount: resultEvent.FailedEntryCount,
            Entries: resultEvent.Entries
        });

        return json(500, { ok: false, message: "AUTH_USER_CREATED_BUT_EVENT_BRIDGE_ERROR" });

    } catch (err) {
        console.error("registerUserCore error", err);
        return json(err.statusCode || 500, {
            ok: false,
            message: "INTERNAL_ERROR",
        });
    }
}

async function createAuthEntry(email, password) {

    const hashedPwd = await hashPassword(password);
    const maxIdRetries = 3;
    for (let attempt = 0; attempt < maxIdRetries; attempt++) {
        const id = nanoid();
        const now = new Date().toISOString();

        const transaction = buildRegisterAuthTransactionItems({
            email: email,
            hashedPassword: hashedPwd,
            generatedUserId: id,
            createdAtIsoTimestamp: now,
            authTableName: AUTH_TABLE,
        });

        try {
            await sendTransactToDb(transaction, true);

            console.info("createAuthEntry success", { email: email, userId: id })

            return {
                statusCode: 201,
                userId: id,
                message: "user successfully created"
            }

        } catch (err) {
            if (err.name === "TransactionCanceledException" && err.CancellationReasons) {
                const cancellationOutcome = classifyRegisterTransactionCancellation(
                    err.CancellationReasons,
                    transaction
                );

                if (cancellationOutcome === REGISTER_CANCELLATION_OUTCOME.EMAIL_ALREADY_EXISTS) {
                    return { statusCode: 409, error: "EMAIL_ALREADY_EXISTS" }
                }

                if (cancellationOutcome === REGISTER_CANCELLATION_OUTCOME.ID_COLLISION) {
                    console.error("ID_COLLISION RETRYING...");
                    if (attempt < maxIdRetries - 1) {
                        await new Promise(r => setTimeout(r, 25 * (attempt + 1)));
                        continue;
                    }
                    console.error({ error: "ID_COLLISION" })
                    throw { statusCode: 409, error: "ID_COLLISION" }
                };
            }
            console.error("Error in createAuthEntry transaction:", err);
            throw err
        }
    }
}

async function createTokenEntry(rawToken, userId) {
    const params = buildAccountValidationTokenItem({
        rawToken: rawToken,
        userId: userId,
        accountValidationTableName: ACCOUNT_VALIDATION_TABLE,
    });
    const result = await sendPutToDb(params);
    return result;
} //peut être que cette partie devrais être dans un autre lambda

function buildUserRegisterEvent(detail, detailType) {
    return {
        Source: "site-asso.auth.register",
        DetailType: detailType,
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify(detail),
    }
}