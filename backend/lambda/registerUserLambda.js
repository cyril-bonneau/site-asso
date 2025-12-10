import { nanoid } from "nanoid";
import crypto from "crypto";
import { validatePasswordBackend } from "../auth/passwordPolicy.js";
import { withRateLimit } from "../rateLimit/withRateLimit.js";
import { hashPassword } from "../auth/auth.js";
import { json, normalizeEmail, buildRefreshCookie, generateRefreshToken, hashRefreshToken } from "../helpers/toolbox.js";
import { sendTransactToDb } from "../dal/requestToDb.js";
import { storeRefreshToken } from "../dal/tokenStore.js";
import { eventBridgePutEvents } from "../eventBridge/registerEventBus.js";
import { signAccessTokenWithKms } from "../auth/signAccessTokenWithKms.js";

const AUTH_TABLE = process.env.AUTH_TABLE;
const EVENT_BUS_NAME = process.env.REGISTER_EVENT_BUS;
const REFRESH_JWT_HMAC = crypto
    .createSecretKey(Buffer.from(process.env.REFRESH_JWT_HMAC, "utf-8"));

// event must contain email, password in body

export const handler = withRateLimit(registerUserCore, {
    scope: "REGISTER",     // nom logique de l’action
    capacity: 3,
    refillRate: 0.1,       // 1 token / 10 s
    cost: 1
})

async function registerUserCore(event) {
    try {
        let data;
        try {
            data = JSON.parse(event.body);
        } catch (err) {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" })
        }

        const email = normalizeEmail(data?.email)
        const { password, firstName, lastName } = data ?? {}
        const privilege = ["USER"];

        if (!email || !password || !firstName || !lastName) {
            return json(400, { ok: false, message: "MISSING_REQUIRED_INFO" })
        }

        const check = await validatePasswordBackend(password, {
            email,
            // username: data.username,
            useHIBP: true // ou false si tu veux éviter l'appel externe
        });

        if (!check.ok) {
            return {
                statusCode: 422,
                body: JSON.stringify({ ok: false, code: "WEAK_PASSWORD", reasons: check.reasons })
            };
        }

        const res = await createAuthEntry(email, password);

        if (res.error === "EMAIL_ALREADY_EXISTS") {
            return json(409, { ok: false, message: "EMAIL_ALREADY_EXISTS" })
        } else if (res.statusCode !== 201) {
            return json(res.statusCode || 500, { ok: false, message: res.error || "INTERNAL_ERROR" })
        }

        const userId = res.userId;
        const payload = { userId, email, privilege };
        const accessToken = await signAccessTokenWithKms(payload);

        // il est attendu au minimum userId, email, firstName, lastName
        const detail = buildUserRegisterDetail({ email, firstName, lastName, userId, privilege });
        const eventEntry = buildUserRegisterEvent(detail);

        const resultEvent = await eventBridgePutEvents(eventEntry);

        try {
            const refreshToken = await generateRefreshToken(userId, REFRESH_JWT_HMAC);

            console.log("refreshToken", refreshToken)

            const hashedRefreshToken = hashRefreshToken(refreshToken);

            console.log("hashedRefreshToken", hashedRefreshToken)

            const response = await storeRefreshToken(hashedRefreshToken, userId);

            console.log("storeRefreshToken result", response)

            if (response.$metadata.httpStatusCode !== 200) {
                console.warn("registerUserCore: storeRefreshToken failed", { response });

                if (!resultEvent.FailedEntryCount) {
                    return json(
                        201,
                        {
                            ok: true,
                            userId: userId,
                            message: res.message
                        }
                    );
                }
            }

            const cookieString = buildRefreshCookie(refreshToken);

            if (!resultEvent.FailedEntryCount) {
                return json(
                    201,
                    {
                        ok: true,
                        userId: userId,
                        accessToken: accessToken,
                        message: res.message
                    },
                    {
                        "Set-Cookie": cookieString
                    }
                );
            }
        } catch (err) {
            console.warn("registerUserCore: error in refreshTokenPart", { err });

            if (!resultEvent.FailedEntryCount) {
                return json(
                    201,
                    {
                        ok: true,
                        userId: userId,
                        message: res.message
                    }
                );
            }
        }

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
        const now = new Date().toISOString()

        const transaction = [
            {
                Put: {
                    TableName: AUTH_TABLE,
                    Item: {
                        PK: `USER#${id}`,
                        SK: "AUTH",
                        userId: id,
                        GSI1PK: `EMAIL#${email}`,
                        GSI1SK: `USER#${id}`,
                        email: email,
                        passwordHash: hashedPwd,
                        createdAt: now,
                    },
                    ConditionExpression: "attribute_not_exists(PK)",
                    ReturnValuesOnConditionCheckFailure: "ALL_OLD",
                },
            },
            {
                Put: {
                    TableName: AUTH_TABLE,
                    Item: {
                        PK: `EMAIL#${email}`,
                        SK: "UNIQUE",
                        userId: `USER#${id}`,
                        createdAt: now,
                    },
                    ConditionExpression: "attribute_not_exists(PK)",
                    ReturnValuesOnConditionCheckFailure: "ALL_OLD",
                }
            }
        ];

        try {

            await sendTransactToDb(transaction, true);

            console.log("createAuthEntry success", { email: email, userId: id })

            return {
                statusCode: 201,
                userId: id,
                message: "user successfully created"
            }

        } catch (err) {

            if (err.name === "TransactionCanceledException" && err.CancellationReasons) {
                const reasons = err.CancellationReasons.map((r, i) => ({
                    index: i,
                    opType: Object.keys(transaction[i])[0],
                    code: r.Code,
                    message: r.Message,
                }));

                const emailCheck = reasons.find(r => r.index === 0);

                if (emailCheck && emailCheck.code === "ConditionalCheckFailed") {
                    return { statusCode: 409, error: "EMAIL_ALREADY_EXISTS" }
                }

                const checkId = reasons.find(r => r.index === 1);

                if (checkId && checkId.code === "ConditionalCheckFailed") {
                    console.error("ID_COLLISION RETRYING...");
                    if (attempt < maxIdRetries - 1) {
                        await new Promise(r => setTimeout(r, 25 * (attempt + 1)));
                        continue;
                    }
                    console.log({ error: "ID_COLLISION" })
                    throw { statusCode: 409, error: "ID_COLLISION" }
                };
            }
            console.error("Error in createAuthEntry transaction:", err);
            throw err
        }
    }
}

function buildUserRegisterDetail({ userId, email, firstName, lastName, privilege }) {
    return {
        userId: userId,
        email: email,
        firstName: firstName,
        lastName: lastName,
        privilege: privilege
    }
}

function buildUserRegisterEvent(detail) {
    return {
        Source: "site-asso.auth.register",
        DetailType: "UserRegistered",
        EventBusName: EVENT_BUS_NAME,
        Detail: JSON.stringify(detail),
    }
}