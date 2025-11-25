import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks hoisted
vi.mock("../../dal/checkPasswordByUserId.js", () => {
    const checkPasswordByUserIdMock = vi.fn();
    return {
        checkPasswordByUserId: (...args) => checkPasswordByUserIdMock(...args),
        __mocks: { checkPasswordByUserIdMock },
    };
});

vi.mock("../../dal/requestToDb.js", () => {
    const sendTransactToDbMock = vi.fn();
    return {
        sendTransactToDb: (...args) => sendTransactToDbMock(...args),
        __mocks: { sendTransactToDbMock },
    };
});

// Imports réels
import { handler as removeAuthUserHandler } from "../../lambda/removeAuthUserLambda.js";
import { __mocks as checkPasswordMocks } from "../../dal/checkPasswordByUserId.js";
import { __mocks as requestToDbMocks } from "../../dal/requestToDb.js";

const { checkPasswordByUserIdMock } = checkPasswordMocks;
const { sendTransactToDbMock } = requestToDbMocks;

describe("removeAuthUserLambda", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AUTH_TABLE = "AuthTableTest";
    });

    it("returns 400 when crucial data is missing", async () => {
        const event = {
            body: JSON.stringify({
                email: "test@example.com",
                password: "password123",
            }),
        };

        const response = await removeAuthUserHandler(event);
        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "MISSING_CRUCIAL_DATA",
        });
    });

    it("returns 403 if password is incorrect", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce({
            ok: false,
            message: "WRONG_PASSWORD",
        });

        const event = {
            body: JSON.stringify({
                email: "test@example.com",
                password: "wrongpassword",
                id: "user-123",
            }),
        };

        const response = await removeAuthUserHandler(event);

        expect(checkPasswordByUserIdMock).toHaveBeenCalledWith({
            userId: "user-123",
            password: "wrongpassword",
            table: "AuthTableTest",
        });

        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "WRONG_PASSWORD",
        });

        expect(sendTransactToDbMock).not.toHaveBeenCalled();
    });

    it("returns 201 when user is successfully removed", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce({
            ok: true,
            statusCode: 200,
            code: "PASSWORD_CORRECT",
        });

        sendTransactToDbMock.mockResolvedValueOnce({
            ok: true,
            data: { success: true },
        });

        const event = {
            body: JSON.stringify({
                email: "test@example.com",
                password: "correctpassword",
                id: "user-123",
            }),
        };

        const response = await removeAuthUserHandler(event);

        expect(checkPasswordByUserIdMock).toHaveBeenCalledWith({
            userId: "user-123",
            password: "correctpassword",
            table: "AuthTableTest",
        });

        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
        const transactPayload = sendTransactToDbMock.mock.calls[0][0];

        expect(transactPayload).toEqual(
            expect.objectContaining({
                client: expect.any(Object),
                TransactItems: expect.arrayContaining([
                    expect.objectContaining({
                        Delete: expect.objectContaining({
                            TableName: "AuthTableTest",
                        }),
                    }),
                ]),
            })
        );

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            message: "User removed"
        });
    });

    it("returns 400 when event body is not valid JSON", async () => {
        const event = {
            body: "{invalidJson: true",
        };

        const response = await removeAuthUserHandler(event);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INVALID_JSON_BODY",
        });
    });
});
