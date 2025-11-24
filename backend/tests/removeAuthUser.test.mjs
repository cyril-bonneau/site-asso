// backend/lambda/__tests__/removeAuthUser.test.mjs
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks hoisted
vi.mock("../dal/checkPasswordByUserId.js", () => {
    const checkPasswordByUserIdMock = vi.fn();
    return {
        checkPasswordByUserId: (...args) => checkPasswordByUserIdMock(...args),
        __mocks: { checkPasswordByUserIdMock }
    };
});

vi.mock("../dal/requestToDb.js", () => {
    const sendTransactToDbMock = vi.fn();
    return {
        sendTransactToDb: (...args) => sendTransactToDbMock(...args),
        __mocks: { sendTransactToDbMock }
    };
});

// Imports after mocks
import { handler as removeAuthUserHandler } from "../removeAuthUserLambda.js";
import { __mocks as checkPasswordMocks } from "../dal/checkPasswordByUserId.js";
import { __mocks as requestToDbMocks } from "../dal/requestToDb.js";

const { checkPasswordByUserIdMock } = checkPasswordMocks;
const { sendTransactToDbMock } = requestToDbMocks;

beforeEach(() => {
    checkPasswordByUserIdMock.mockReset();
    sendTransactToDbMock.mockReset();
    process.env.AUTH_TABLE = "AuthTableTest";
});

describe("removeAuthUserLambda", () => {
    it("removes the user when password is correct", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce(true);
        sendTransactToDbMock.mockResolvedValueOnce({});

        const event = {
            body: JSON.stringify({
                id: "abc123",
                email: "test@example.com",
                password: "Secret123!"
            })
        };

        const res = await removeAuthUserHandler(event);

        expect(res.statusCode).toBe(201);
        const body = JSON.parse(res.body);
        expect(body.ok).toBe(true);

        expect(checkPasswordByUserIdMock).toHaveBeenCalledTimes(1);

        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
        const [transactItems] = sendTransactToDbMock.mock.calls[0];

        expect(transactItems).toEqual([
            {
                Delete: {
                    TableName: "AuthTableTest",
                    Key: { PK: "USER#abc123", SK: "AUTH" },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
                }
            },
            {
                Delete: {
                    TableName: "AuthTableTest",
                    Key: { PK: "EMAIL#test@example.com", SK: "UNIQUE" },
                    ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
                }
            }
        ]);
    });

    it("returns 403 when password is incorrect", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce(false);

        const event = {
            body: JSON.stringify({
                id: "abc123",
                email: "test@example.com",
                password: "bad"
            })
        };

        const res = await removeAuthUserHandler(event);

        expect(res.statusCode).toBe(403);
        const body = JSON.parse(res.body);
        expect(body.message).toBe("WRONG_PASSWORD");

        expect(sendTransactToDbMock).not.toHaveBeenCalled();
    });

    it("returns 500 when DynamoDB TransactWrite fails", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce(true);
        sendTransactToDbMock.mockRejectedValueOnce(new Error("DDB down"));

        const event = {
            body: JSON.stringify({
                id: "abc123",
                email: "test@example.com",
                password: "ok"
            })
        };

        const res = await removeAuthUserHandler(event);

        expect(res.statusCode).toBe(500);
        const body = JSON.parse(res.body);
        expect(body.message).toBe("INTERNAL_ERROR");
    });

    it("returns 400 on invalid JSON", async () => {
        const event = {
            body: "{ invalid json"
        };

        const res = await removeAuthUserHandler(event);

        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.message).toBe("INVALID_JSON_BODY");

        expect(checkPasswordByUserIdMock).not.toHaveBeenCalled();
    });

    it("returns 400 when required fields are missing", async () => {
        const event = {
            body: JSON.stringify({
                email: "test@example.com"
            })
        };

        const res = await removeAuthUserHandler(event);

        expect(res.statusCode).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.message).toBe("MISSING_CRUCIAL_DATA");

        expect(checkPasswordByUserIdMock).not.toHaveBeenCalled();
        expect(sendTransactToDbMock).not.toHaveBeenCalled();
    });
});
