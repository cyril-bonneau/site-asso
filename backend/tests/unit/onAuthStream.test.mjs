import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks hoistés ---

vi.mock("@aws-sdk/client-dynamodb", () => {
    const sendMock = vi.fn();

    class DynamoDBClient {
        constructor() {
            this.send = sendMock;
        }
    }

    class PutItemCommand {
        constructor(input) {
            this.input = input;
        }
    }

    return {
        DynamoDBClient,
        PutItemCommand,
        __mocks: { sendMock },
    };
});

vi.mock("@aws-sdk/util-dynamodb", () => ({
    marshall: (obj) => obj,
    unmarshall: (obj) => {
        // mini-unmarshall: { email: { S: "x" } } → { email: "x" }
        const out = {};
        for (const [key, value] of Object.entries(obj || {})) {
            if (value && typeof value === "object" && "S" in value) {
                out[key] = value.S;
            } else {
                out[key] = value;
            }
        }
        return out;
    },
}));

// --- Imports réels ---

import { handler as onAuthStreamHandler } from "../../lambda/onAuthStreamLambda.js";
import { __mocks as ddbMocks } from "@aws-sdk/client-dynamodb";

const { sendMock } = ddbMocks;

describe("onAuthStreamLambda", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AUTH_TABLE = "AuthTableTest";
        process.env.USER_TABLE = "UserTableTest";
    });

    it("insère les données dans USER_TABLE quand il reçoit un event INSERT", async () => {
        const event = {
            Records: [
                {
                    eventName: "INSERT",
                    dynamodb: {
                        NewImage: {
                            userId: { S: "user-123" },
                            email: { S: "test@example.com" },
                            firstName: { S: "John" },
                            lastName: { S: "Doe" },
                        },
                    },
                },
            ],
        };

        sendMock.mockResolvedValueOnce({});
        sendMock.mockResolvedValueOnce({});

        await onAuthStreamHandler(event);

        expect(sendMock).toHaveBeenCalledTimes(2);

        const firstCall = sendMock.mock.calls[0][0];
        expect(firstCall.input).toEqual({
            TableName: "UserTableTest",
            Item: {
                PK: "EMAIL#test@example.com",
                SK: "UNIQUE",
                userId: "user-123",
                createdAt: expect.any(String),
            },
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        });

        const secondCall = sendMock.mock.calls[1][0];
        expect(secondCall.input).toEqual({
            TableName: "UserTableTest",
            Item: {
                PK: "USER#user-123",
                SK: "PROFILE#user-123",
                GSI1PK: "USER#EMAIL",
                GSI1SK: "test@example.com",
                userId: "user-123",
                email: "test@example.com",
                firstName: "John",
                lastName: "Doe",
                createdAt: expect.any(String),
                updatedAt: expect.any(String)
            },
            ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        });
    });

    it("ignore les événements qui ne sont pas INSERT", async () => {
        const event = {
            Records: [
                {
                    eventName: "MODIFY",
                    dynamodb: {
                        NewImage: {
                            userId: { S: "user-123" },
                            email: { S: "test@example.com" },
                        },
                    },
                },
            ],
        };

        await onAuthStreamHandler(event);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it("lance une erreur 'Internal error' si DynamoDB échoue", async () => {
        const event = {
            Records: [
                {
                    eventName: "INSERT",
                    dynamodb: {
                        NewImage: {
                            userId: { S: "user-err" },
                            email: { S: "err@example.com" },
                        },
                    },
                },
            ],
        };

        sendMock.mockRejectedValueOnce(new Error("DynamoDB error"));
        sendMock.mockRejectedValueOnce(new Error("DynamoDB error"));

        await expect(onAuthStreamHandler(event)).rejects.toThrow("DynamoDB error")
    });
});
