import { describe, it, beforeEach, expect, vi } from "vitest";

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
    marshall: (obj) => obj, // on peut se contenter de renvoyer l'objet tel quel
    unmarshall: (obj) => {
        // mini-unmarshall : { field: { S: "x" } } -> { field: "x" }
        const out = {};
        for (const [k, v] of Object.entries(obj || {})) {
            if (v && typeof v === "object" && "S" in v) {
                out[k] = v.S;
            } else {
                out[k] = v;
            }
        }
        return out;
    },
}));

import { __mocks as ddbMocks } from "@aws-sdk/client-dynamodb";
const { sendMock } = ddbMocks;

describe("onAuthStreamLambda", () => {
    beforeEach(() => {
        vi.clearAllMocks();
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

        const { handler: onAuthStreamHandler } = await import("../../lambda/onAuthStreamLambda.js");

        sendMock.mockResolvedValueOnce({});
        sendMock.mockResolvedValueOnce({});

        await onAuthStreamHandler(event);

        const firstCall = sendMock.mock.calls[0][0];
        const secondCall = sendMock.mock.calls[1][0];

        expect(firstCall.input).toEqual({
            TableName: "UserTableTest",
            Item: {
                PK: "EMAIL#test@example.com",
                SK: "UNIQUE",
                userId: "user-123",
                createdAt: expect.any(String),
            },
            ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        });

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
                updatedAt: expect.any(String),
            },
            ConditionExpression:
                "attribute_not_exists(PK) AND attribute_not_exists(SK)",
        });
    });

    it("ignore les événements non-INSERT", async () => {
        const event = {
            Records: [
                {
                    eventName: "MODIFY",
                    dynamodb: { NewImage: {} },
                },
            ],
        };

        const { handler: onAuthStreamHandler } = await import("../../lambda/onAuthStreamLambda.js");

        await onAuthStreamHandler(event);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it("remonte l'erreur DynamoDB brute (pass-through)", async () => {
        const event = {
            Records: [
                {
                    eventName: "INSERT",
                    dynamodb: {
                        NewImage: {
                            userId: { S: "u" },
                            email: { S: "x@test.com" },
                        },
                    },
                },
            ],
        };

        sendMock.mockRejectedValueOnce(new Error("DynamoDB error"));

        const { handler: onAuthStreamHandler } = await import("../../lambda/onAuthStreamLambda.js");

        await expect(onAuthStreamHandler(event)).rejects.toThrow("DynamoDB error");
    });
});
