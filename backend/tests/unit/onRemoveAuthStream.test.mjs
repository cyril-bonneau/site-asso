import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../dal/requestToDb.js", () => {
    const sendTransactToDbMock = vi.fn();
    return {
        sendTransactToDb: (...args) => sendTransactToDbMock(...args),
        __mocks: { sendTransactToDbMock },
    };
});

vi.mock("@aws-sdk/util-dynamodb", () => ({
    unmarshall: (obj) => obj,
}));

import { handler as onRemoveAuthStreamHandler } from "../../lambda/onRemoveAuthStreamLambda.js";
import { __mocks as requestToDbMocks } from "../../dal/requestToDb.js";

const { sendTransactToDbMock } = requestToDbMocks;

describe("onRemoveAuthStreamLambda", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.USER_TABLE = "UserTableTest";
    });

    it("builds a TransactWrite with PROFILE and EMAIL delete", async () => {
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

        sendTransactToDbMock.mockResolvedValueOnce({
            ok: true,
            data: { success: true },
        });

        await onRemoveAuthStreamHandler(event);

        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
        const call = sendTransactToDbMock.mock.calls[0][0];

        expect(call).toEqual(
            expect.objectContaining({
                client: expect.any(Object),
                TransactItems: [
                    {
                        Delete: {
                            TableName: "UserTableTest",
                            Key: {
                                PK: "USER#user-123",
                                SK: "PROFILE#user-123"
                            },
                            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
                        },
                    },
                    {
                        Delete: {
                            TableName: "UserTableTest",
                            Key: {
                                PK: "EMAIL@test@example.com",
                                SK: "UNIQUE"
                            },
                            ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)",
                        },
                    },
                ],
            })
        );
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

        await onRemoveAuthStreamHandler(event);
        expect(sendTransactToDbMock).not.toHaveBeenCalled();
    });
});
