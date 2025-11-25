import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../dal/checkPasswordByUserId.js", () => {
    const checkPasswordByUserIdMock = vi.fn();
    return {
        checkPasswordByUserId: (...a) => checkPasswordByUserIdMock(...a),
        __mocks: { checkPasswordByUserIdMock },
    };
});

vi.mock("../../dal/requestToDb.js", () => {
    const sendTransactToDbMock = vi.fn();
    return {
        sendTransactToDb: (...a) => sendTransactToDbMock(...a),
        __mocks: { sendTransactToDbMock },
    };
});

import { __mocks as checkMocks } from "../../dal/checkPasswordByUserId.js";
import { __mocks as trxMocks } from "../../dal/requestToDb.js";

import { handler as removeAuthUserHandler } from "../../lambda/removeAuthUserLambda.js";

const { checkPasswordByUserIdMock } = checkMocks;
const { sendTransactToDbMock } = trxMocks;

describe("removeAuthUserLambda", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AUTH_TABLE = "AuthTableTest";
    });

    it("returns 400 when missing fields", async () => {
        const response = await removeAuthUserHandler({
            body: JSON.stringify({ email: "a@a.com" }),
        });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "MISSING_CRUCIAL_DATA",
        });
    });

    it("returns 403 on wrong password", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce(false);

        const response = await removeAuthUserHandler({
            body: JSON.stringify({
                email: "test@example.com",
                password: "wrong",
                id: "user-123",
            }),
        });

        expect(checkPasswordByUserIdMock).toHaveBeenCalledWith({
            userId: "user-123",
            password: "wrong",
        });

        expect(sendTransactToDbMock).not.toHaveBeenCalled();

        expect(response.statusCode).toBe(403);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "WRONG_PASSWORD",
        });
    });

    it("returns 201 on successful delete", async () => {
        checkPasswordByUserIdMock.mockResolvedValueOnce(true);
        sendTransactToDbMock.mockResolvedValueOnce({ ok: true });

        const response = await removeAuthUserHandler({
            body: JSON.stringify({
                email: "test@example.com",
                password: "correct",
                id: "user-123",
            }),
        });

        expect(sendTransactToDbMock).toHaveBeenCalledTimes(1);
        const trx = sendTransactToDbMock.mock.calls[0][0];

        expect(trx).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    Delete: expect.objectContaining({
                        Key: { PK: "USER#user-123", SK: "AUTH" },
                    }),
                }),
                expect.objectContaining({
                    Delete: expect.objectContaining({
                        Key: { PK: "EMAIL#test@example.com", SK: "UNIQUE" },
                    }),
                }),
            ])
        );

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            message: "User removed",
        });
    });

    it("returns 400 on invalid JSON", async () => {
        const response = await removeAuthUserHandler({ body: "{nope" });

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INVALID_JSON_BODY",
        });
    });
});
