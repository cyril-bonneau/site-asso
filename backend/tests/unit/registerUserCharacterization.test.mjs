/**
 * CHARACTERIZATION TESTS — register flow.
 *
 * These tests capture the CURRENT observable behavior of registerUserLambda,
 * including behavior that is known to be defective (see OUT_OF_SCOPE_OBSERVATIONS
 * in the refactoring report, referenced below as OOS-1 and OOS-2).
 *
 * They are NOT a specification of desired behavior. Do not "correct" an expectation
 * here to make a refactoring step pass — if one of these changes value, the
 * refactoring step has FAILED and must be reverted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Module-level `const`s in registerUserLambda.js capture process.env at import time,
// so the environment must be populated before the static imports are evaluated.
vi.hoisted(() => {
    process.env.AUTH_TABLE = "AuthTableTest";
    process.env.REGISTER_EVENT_BUS = "RegisterEventBusTest";
    process.env.ACCOUNT_VALIDATION_TABLE = "AccountValidationTableTest";
});

vi.mock("../../auth/passwordPolicy.js", () => {
    const validatePasswordBackendMock = vi.fn();
    return {
        validatePasswordBackend: (...args) => validatePasswordBackendMock(...args),
        __mocks: { validatePasswordBackendMock },
    };
});

vi.mock("argon2", () => {
    const hashMock = vi.fn();
    return {
        default: {
            hash: (...args) => hashMock(...args),
            argon2id: 2,
        },
        __mocks: { hashMock },
    };
});

vi.mock("nanoid", () => {
    const nanoidMock = vi.fn();
    return {
        nanoid: (...args) => nanoidMock(...args),
        __mocks: { nanoidMock },
    };
});

vi.mock("@aws-sdk/client-dynamodb", () => ({
    DynamoDBClient: class DynamoDBClient { },
}));

// The pre-existing unit test mocked only DynamoDBDocumentClient + TransactWriteCommand.
// requestToDb.js imports six commands, so PutCommand resolved to a missing-export proxy
// that threw the moment createTokenEntry ran — which is why the happy path could never
// be exercised. All six are supplied here.
vi.mock("@aws-sdk/lib-dynamodb", () => {
    const sendMock = vi.fn();

    class TransactWriteCommand {
        constructor(input) { this.input = input; }
    }
    class PutCommand {
        constructor(input) { this.input = input; }
    }
    class GetCommand {
        constructor(input) { this.input = input; }
    }
    class UpdateCommand {
        constructor(input) { this.input = input; }
    }
    class DeleteCommand {
        constructor(input) { this.input = input; }
    }
    class QueryCommand {
        constructor(input) { this.input = input; }
    }

    return {
        DynamoDBDocumentClient: { from: () => ({ send: (...args) => sendMock(...args) }) },
        TransactWriteCommand,
        PutCommand,
        GetCommand,
        UpdateCommand,
        DeleteCommand,
        QueryCommand,
        __mocks: { sendMock, TransactWriteCommand, PutCommand },
    };
});

vi.mock("../../eventBridge/registerEventBus.js", () => {
    const eventBridgePutEventsMock = vi.fn();
    return {
        eventBridgePutEvents: (...args) => eventBridgePutEventsMock(...args),
        __mocks: { eventBridgePutEventsMock },
    };
});

vi.mock("../../rateLimit/withRateLimit.js", () => ({
    withRateLimit: (handler, _opts) => handler,
}));

import { __mocks as passwordPolicyMocks } from "../../auth/passwordPolicy.js";
import { __mocks as argonMocks } from "argon2";
import { __mocks as nanoidMocks } from "nanoid";
import { __mocks as dynamoDbMocks } from "@aws-sdk/lib-dynamodb";
import { __mocks as eventBridgeMocks } from "../../eventBridge/registerEventBus.js";

import { handler as registerUserHandler } from "../../lambda/registerUserLambda.js";

const { validatePasswordBackendMock } = passwordPolicyMocks;
const { hashMock: argonHashMock } = argonMocks;
const { nanoidMock } = nanoidMocks;
const { sendMock, TransactWriteCommand, PutCommand } = dynamoDbMocks;
const { eventBridgePutEventsMock } = eventBridgeMocks;

const FROZEN_REGISTRATION_ISO_TIMESTAMP = "2026-01-15T10:00:00.000Z";
const FROZEN_REGISTRATION_EPOCH_SECONDS = Math.floor(
    new Date(FROZEN_REGISTRATION_ISO_TIMESTAMP).getTime() / 1000
);
const EXPECTED_EXPIRED_AT_EPOCH_SECONDS =
    FROZEN_REGISTRATION_EPOCH_SECONDS + 24 * 60 * 60;

const VALID_REGISTRATION_PAYLOAD = {
    email: "test@example.com",
    password: "StrongPwd123!",
    firstName: "Jack",
    lastName: "Larnaque",
};

function buildRegistrationEvent(payloadOverrides = {}) {
    return {
        body: JSON.stringify({ ...VALID_REGISTRATION_PAYLOAD, ...payloadOverrides }),
    };
}

function buildTransactionCanceledException(cancellationReasons) {
    const transactionCanceledException = new Error("Transaction cancelled");
    transactionCanceledException.name = "TransactionCanceledException";
    transactionCanceledException.CancellationReasons = cancellationReasons;
    return transactionCanceledException;
}

const CANCELLATION_AT_TRANSACTION_INDEX_ZERO = [
    { Code: "ConditionalCheckFailed", Message: "The conditional request failed" },
    { Code: "None" },
];

const CANCELLATION_AT_TRANSACTION_INDEX_ONE = [
    { Code: "None" },
    { Code: "ConditionalCheckFailed", Message: "The conditional request failed" },
];

const SUCCESSFUL_EVENT_BRIDGE_RESULT = {
    FailedEntryCount: 0,
    Entries: [{ EventId: "event-id-1" }],
};

function getTransactWriteCommandCalls() {
    return sendMock.mock.calls
        .map(([command]) => command)
        .filter((command) => command instanceof TransactWriteCommand);
}

function getPutCommandCalls() {
    return sendMock.mock.calls
        .map(([command]) => command)
        .filter((command) => command instanceof PutCommand);
}

describe("registerUserLambda — characterization", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        // Fake only Date so Date.now()/new Date() are frozen, while leaving setTimeout
        // real — createAuthEntry sleeps between id-collision retries and would otherwise
        // never settle.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date(FROZEN_REGISTRATION_ISO_TIMESTAMP));

        vi.spyOn(console, "log").mockImplementation(() => { });
        vi.spyOn(console, "info").mockImplementation(() => { });
        vi.spyOn(console, "warn").mockImplementation(() => { });
        vi.spyOn(console, "error").mockImplementation(() => { });

        validatePasswordBackendMock.mockResolvedValue({ ok: true });
        argonHashMock.mockResolvedValue("HASHED_PASSWORD");
        nanoidMock.mockReturnValue("generatedUserId");
        eventBridgePutEventsMock.mockResolvedValue(SUCCESSFUL_EVENT_BRIDGE_RESULT);
        sendMock.mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // --- C1 -----------------------------------------------------------------
    it("C1 — returns 201 with { ok, userId, message } and the standard json() envelope", async () => {
        const response = await registerUserHandler(buildRegistrationEvent());

        expect(response.statusCode).toBe(201);
        expect(response.headers).toEqual({ "content-type": "application/json" });
        expect(response.cookies).toEqual([]);

        // The 201 body carries the RAW nanoid, and carries no `statusCode` key.
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            userId: "generatedUserId",
            message: "user successfully created",
        });

        expect(validatePasswordBackendMock).toHaveBeenCalledWith("StrongPwd123!", {
            email: "test@example.com",
            useHIBP: true,
        });
        expect(argonHashMock.mock.calls[0][0]).toBe("StrongPwd123!");
    });

    // --- C2 -----------------------------------------------------------------
    it("C2 — writes the exact two-item transaction, in order, with the documented attributes", async () => {
        const response = await registerUserHandler(
            buildRegistrationEvent({ email: "Test@Example.COM" })
        );

        expect(response.statusCode).toBe(201);

        const transactWriteCommands = getTransactWriteCommandCalls();
        expect(transactWriteCommands).toHaveLength(1);

        expect(transactWriteCommands[0].input).toEqual({
            ReturnCancellationReasons: true,
            ReturnConsumedCapacity: "TOTAL",
            TransactItems: [
                {
                    Put: {
                        TableName: "AuthTableTest",
                        Item: {
                            PK: "USER#generatedUserId",
                            SK: "AUTH",
                            // index 0 stores the RAW id...
                            userId: "generatedUserId",
                            email: "test@example.com",
                            passwordHash: "HASHED_PASSWORD",
                            createdAt: FROZEN_REGISTRATION_ISO_TIMESTAMP,
                            expiredAt: EXPECTED_EXPIRED_AT_EPOCH_SECONDS,
                        },
                        ConditionExpression: "attribute_not_exists(PK)",
                        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
                    },
                },
                {
                    Put: {
                        TableName: "AuthTableTest",
                        Item: {
                            PK: "EMAIL#test@example.com",
                            SK: "UNIQUE",
                            // ...while index 1 stores the USER#-PREFIXED id.
                            userId: "USER#generatedUserId",
                            validated: false,
                            createdAt: FROZEN_REGISTRATION_ISO_TIMESTAMP,
                            expiredAt: EXPECTED_EXPIRED_AT_EPOCH_SECONDS,
                        },
                        ConditionExpression: "attribute_not_exists(PK)",
                        ReturnValuesOnConditionCheckFailure: "ALL_OLD",
                    },
                },
            ],
        });
    });

    // --- C3 -----------------------------------------------------------------
    it("C3 — a cancellation at transaction index 0 yields 409 EMAIL_ALREADY_EXISTS", async () => {
        sendMock.mockRejectedValueOnce(
            buildTransactionCanceledException(CANCELLATION_AT_TRANSACTION_INDEX_ZERO)
        );

        const response = await registerUserHandler(buildRegistrationEvent());

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "EMAIL_ALREADY_EXISTS",
        });

        // Classified immediately — no retry.
        expect(getTransactWriteCommandCalls()).toHaveLength(1);
        expect(eventBridgePutEventsMock).not.toHaveBeenCalled();
    });

    // --- C4 -----------------------------------------------------------------
    it("C4 — a cancellation at transaction index 1 retries exactly 3 times with a fresh id each time", async () => {
        sendMock.mockRejectedValue(
            buildTransactionCanceledException(CANCELLATION_AT_TRANSACTION_INDEX_ONE)
        );
        nanoidMock
            .mockReturnValueOnce("generatedUserId1")
            .mockReturnValueOnce("generatedUserId2")
            .mockReturnValueOnce("generatedUserId3");

        const response = await registerUserHandler(buildRegistrationEvent());

        expect(nanoidMock).toHaveBeenCalledTimes(3);
        expect(getTransactWriteCommandCalls()).toHaveLength(3);

        const attemptedPartitionKeys = getTransactWriteCommandCalls().map(
            (command) => command.input.TransactItems[0].Put.Item.PK
        );
        expect(attemptedPartitionKeys).toEqual([
            "USER#generatedUserId1",
            "USER#generatedUserId2",
            "USER#generatedUserId3",
        ]);

        // The thrown value is a plain object { statusCode: 409, error: "ID_COLLISION" },
        // so the outer catch reads err.statusCode = 409 but emits the generic message.
        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INTERNAL_ERROR",
        });

        expect(eventBridgePutEventsMock).not.toHaveBeenCalled();
    });

    // --- C5 -----------------------------------------------------------------
    it("C5 — OOS-2: a duplicate email is reported as 409 INTERNAL_ERROR, not EMAIL_ALREADY_EXISTS", async () => {
        // A real duplicate email fails the ConditionExpression on the EMAIL# Put,
        // which is transaction index 1. The implementation binds index 1 to `checkId`
        // and index 0 to `emailCheck`, so a duplicate email is classified as an
        // ID_COLLISION and burns all three retries before failing.
        sendMock.mockRejectedValue(
            buildTransactionCanceledException(CANCELLATION_AT_TRANSACTION_INDEX_ONE)
        );

        const response = await registerUserHandler(buildRegistrationEvent());

        expect(response.statusCode).toBe(409);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INTERNAL_ERROR",
        });
        expect(JSON.parse(response.body).message).not.toBe("EMAIL_ALREADY_EXISTS");
        expect(getTransactWriteCommandCalls()).toHaveLength(3);
    });

    // --- C6 -----------------------------------------------------------------
    it("C6 — a failure writing the validation token yields 500 and emits no events", async () => {
        sendMock.mockImplementation(async (command) => {
            if (command instanceof PutCommand) {
                throw new Error("AccessDeniedException");
            }
            return { $metadata: { httpStatusCode: 200 } };
        });

        const response = await registerUserHandler(buildRegistrationEvent());

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INTERNAL_ERROR",
        });

        // The auth rows are already committed at this point; the events are not sent.
        expect(getTransactWriteCommandCalls()).toHaveLength(1);
        expect(eventBridgePutEventsMock).not.toHaveBeenCalled();
    });

    // --- C7 -----------------------------------------------------------------
    it("C7 — emits UserRegistered then emailValidation, after the token write, with exact Detail payloads", async () => {
        const response = await registerUserHandler(buildRegistrationEvent());
        expect(response.statusCode).toBe(201);

        const putCommands = getPutCommandCalls();
        expect(putCommands).toHaveLength(1);

        const validationTokenItem = putCommands[0].input.Item;
        const generatedValidationToken = validationTokenItem.PK;

        // randomBytes(32).toString("base64url") — 43 unpadded base64url characters.
        expect(generatedValidationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

        expect(putCommands[0].input).toEqual({
            TableName: "AccountValidationTableTest",
            Item: {
                PK: generatedValidationToken,
                SK: "EMAIL_VALIDATION",
                userId: "generatedUserId",
                createdAt: FROZEN_REGISTRATION_ISO_TIMESTAMP,
                expiredAt: EXPECTED_EXPIRED_AT_EPOCH_SECONDS,
            },
        });

        expect(eventBridgePutEventsMock).toHaveBeenCalledTimes(2);

        expect(eventBridgePutEventsMock.mock.calls[0][0]).toEqual({
            Source: "site-asso.auth.register",
            DetailType: "UserRegistered",
            EventBusName: "RegisterEventBusTest",
            Detail: JSON.stringify({
                email: "test@example.com",
                firstName: "Jack",
                lastName: "Larnaque",
                userId: "generatedUserId",
                privilege: ["USER"],
            }),
        });

        // The emailValidation detail carries the token and nothing else — no userId, no email.
        expect(eventBridgePutEventsMock.mock.calls[1][0]).toEqual({
            Source: "site-asso.auth.register",
            DetailType: "emailValidation",
            EventBusName: "RegisterEventBusTest",
            Detail: JSON.stringify({ validationToken: generatedValidationToken }),
        });

        // Ordering: token write strictly precedes both events.
        const tokenWriteOrder = sendMock.mock.invocationCallOrder.at(-1);
        expect(eventBridgePutEventsMock.mock.invocationCallOrder[0]).toBeGreaterThan(
            tokenWriteOrder
        );
        expect(eventBridgePutEventsMock.mock.invocationCallOrder[1]).toBeGreaterThan(
            eventBridgePutEventsMock.mock.invocationCallOrder[0]
        );
    });

    // --- C8 -----------------------------------------------------------------
    it("C8 — a schema violation yields 400 INVALID_INPUT and drops the per-field details", async () => {
        const response = await registerUserHandler(
            buildRegistrationEvent({ firstName: "J4CK", lastName: "L45N4QUE" })
        );

        expect(response.statusCode).toBe(400);

        const parsedBody = JSON.parse(response.body);
        expect(parsedBody).toEqual({ ok: false, message: "INVALID_INPUT" });
        // validateInput builds a `details` array, but registerUserCore forwards only `message`.
        expect(parsedBody.details).toBeUndefined();
        expect(parsedBody.errors).toBeUndefined();

        expect(sendMock).not.toHaveBeenCalled();
    });

    // --- C9 -----------------------------------------------------------------
    it("C9 — OOS-1: a failed event entry yields 500 INTERNAL_ERROR, never AUTH_USER_CREATED_BUT_EVENT_BRIDGE_ERROR", async () => {
        // `err` on the line after the 201 branch is not bound in that scope, so reading it
        // throws a ReferenceError that the outer catch maps to a generic 500. The
        // AUTH_USER_CREATED_BUT_EVENT_BRIDGE_ERROR return below it is unreachable.
        eventBridgePutEventsMock.mockResolvedValue({
            FailedEntryCount: 1,
            Entries: [{ ErrorCode: "InternalException" }],
        });

        const response = await registerUserHandler(buildRegistrationEvent());

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INTERNAL_ERROR",
        });
        expect(JSON.parse(response.body).message).not.toBe(
            "AUTH_USER_CREATED_BUT_EVENT_BRIDGE_ERROR"
        );
    });
});
