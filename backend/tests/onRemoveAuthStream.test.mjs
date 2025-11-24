// backend/lambda/__tests__/onRemoveAuthStream.test.mjs
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks hoisted
vi.mock("../dal/requestToDb.js", () => {
    const sendTransactToDbMock = vi.fn();
    return {
        sendTransactToDb: (...args) => sendTransactToDbMock(...args),
        __mocks: { sendTransactToDbMock }
    };
});

vi.mock("@aws-sdk/util-dynamodb", () => ({
    unmarshall: (raw) => raw
}));

// Imports after mocks
import { handler as onRemoveAuthStreamHandler } from "../lambda/onRemoveAuthStreamLambda.js";
import { __mocks as requestToDbMocks } from "../dal/requestToDb.js";

const { sendTransactToDbMock } = requestToDbMocks;

beforeEach(() => {
    sendTransactToDbMock.mockReset();
    process.env.USER_TABLE = "UserTableTest";
});

describe("onRemoveAuthStreamLambda", () => {
    it("processes REMOVE event and issues a TransactWrite with USER and EMAIL deletes", async () => {
        sendTransactToDbMock.mockResolvedValueOnce({});

        const event = {
            Records: [
                {
                    eventName: "REMOVE",
                    dynamodb: {
                        OldImage: {
                            email: "test@example.com",
                            userId: "user-123"
                        }
                    }
                }
            ]
        };

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined();

        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
        const [transactItems] = sendTransactToDbMock.mock.calls[0];

        expect(transactItems).toEqual([
            {
                Delete: {
                    TableName: "UserTableTest",
                    Key: { PK: "USER#user-123", SK: "PROFILE#user-123" },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
                }
            },
            {
                Delete: {
                    TableName: "UserTableTest",
                    Key: { PK: "EMAIL#test@example.com", SK: "UNIQUE" },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
                }
            }
        ]);
    });

    it("skips ConditionalCheckFailedException and continues processing", async () => {
        const err = new Error("CCF");
        err.name = "ConditionalCheckFailedException";
        sendTransactToDbMock.mockRejectedValueOnce(err);

        const event = {
            Records: [
                {
                    eventName: "REMOVE",
                    dynamodb: {
                        OldImage: {
                            email: "dup@example.com",
                            userId: "user-dup"
                        }
                    }
                }
            ]
        };

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined();
        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
    });

    it("logs error and does not throw on non-CCF errors (current implementation)", async () => {
        const err = new Error("Internal");
        err.name = "InternalServerError";
        sendTransactToDbMock.mockRejectedValueOnce(err);

        const event = {
            Records: [
                {
                    eventName: "REMOVE",
                    dynamodb: {
                        OldImage: {
                            email: "err@example.com",
                            userId: "user-err"
                        }
                    }
                }
            ]
        };

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined();
        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
    });

    it("ignores non-REMOVE events", async () => {
        const event = {
            Records: [
                {
                    eventName: "INSERT",
                    dynamodb: { OldImage: { email: "x", userId: "y" } }
                }
            ]
        };

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined();
        expect(sendTransactToDbMock).not.toHaveBeenCalled();
    });
});
