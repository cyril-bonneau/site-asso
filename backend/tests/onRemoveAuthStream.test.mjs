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
});

describe("onRemoveAuthStreamLambda", () => {
    it("processes REMOVE event and issues a write with USER and EMAIL deletes", async () => {
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

        expect(transactItems).toHaveLength(2);

        // 1er delete : profil utilisateur
        expect(transactItems[0].Delete.Key).toEqual({
            PK: "USER#user-123",
            SK: "PROFILE#user-123"
        });
        expect(transactItems[0].Delete.ConditionExpression)
            .toBe("attribute_exists(PK) AND attribute_exists(SK)");

        // 2e delete : lock email
        expect(transactItems[1].Delete.Key).toEqual({
            PK: "EMAIL#test@example.com",
            SK: "UNIQUE"
        });
        expect(transactItems[1].Delete.ConditionExpression)
            .toBe("attribute_exists(PK) AND attribute_exists(SK)");
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

    it("logs error and does not throw on other errors (current implementation)", async () => {
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
                    dynamodb: {
                        OldImage: {
                            email: "x@example.com",
                            userId: "user-x"
                        }
                    }
                }
            ]
        };

        await expect(onRemoveAuthStreamHandler(event)).resolves.toBeUndefined();
        expect(sendTransactToDbMock).not.toHaveBeenCalled();
    });
});
