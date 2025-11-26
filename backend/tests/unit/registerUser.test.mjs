import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks hoistés ---
vi.mock("../../auth/passwordPolicy.js", () => {
    const validatePasswordBackendMock = vi.fn();
    return {
        validatePasswordBackend: (...args) =>
            validatePasswordBackendMock(...args),
        __mocks: { validatePasswordBackendMock },
    };
});

vi.mock("argon2", () => {
    const hashMock = vi.fn();
    return {
        default: {
            hash: (...args) => hashMock(...args),
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

vi.mock("@aws-sdk/lib-dynamodb", () => {
    const sendMock = vi.fn();
    const clientConstructor = vi.fn(() => ({ send: (...a) => sendMock(...a) }));

    class TransactWriteCommand {
        constructor(input) {
            this.input = input;
        }
    }

    return {
        DynamoDBDocumentClient: { from: clientConstructor },
        TransactWriteCommand,
        __mocks: { sendMock, clientConstructor },
    };
});

vi.mock("../../rateLimit/withRateLimit.js", () => ({
    withRateLimit: (handler, _opts) => handler,
}));

import { __mocks as passwordMocks } from "../../auth/passwordPolicy.js";
import { __mocks as argonMocks } from "argon2";
import { __mocks as nanoidMocks } from "nanoid";
import { __mocks as ddbMocks } from "@aws-sdk/lib-dynamodb";

import { handler as registerUserHandler } from "../../lambda/registerUserLambda.js";

const { validatePasswordBackendMock } = passwordMocks;
const { hashMock: argonHashMock } = argonMocks;
const { nanoidMock } = nanoidMocks;
const { sendMock } = ddbMocks;

describe("registerUserLambda", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AUTH_TABLE = "AuthTableTest";
    });

    it("Crée un utilisateur et retourne 201", async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true });
        nanoidMock.mockReturnValueOnce("user-123");
        argonHashMock.mockResolvedValueOnce("HASHED_PWD");

        sendMock.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });

        const event = {
            body: JSON.stringify({
                email: "test@example.com",
                password: "StrongPwd123!",
            }),
        };

        const response = await registerUserHandler(event);

        expect(validatePasswordBackendMock).toHaveBeenCalledWith(
            "StrongPwd123!",
            {
                email: "test@example.com",
                useHIBP: true,
            }
        );

        expect(argonHashMock.mock.calls[0][0]).toBe("StrongPwd123!");

        expect(sendMock).toHaveBeenCalledTimes(1);
        const trx = sendMock.mock.calls[0][0].input.TransactItems;

        expect(trx.length).toBe(2);

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            statusCode: 201,
            message: "user successfully created",
        });
    });

    it("Retourne 422 si mot de passe faible", async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({
            ok: false,
            reasons: ["TOO_SHORT"],
        });

        const response = await registerUserHandler({
            body: JSON.stringify({
                email: "x@test.com",
                password: "weak",
            }),
        });

        expect(response.statusCode).toBe(422);
    });

    it("Retourne 400 si JSON invalide", async () => {
        const response = await registerUserHandler({
            body: "{nope",
        });

        expect(response.statusCode).toBe(400);
    });

    it("Retourne 500 si Tesla implose", async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true });
        nanoidMock.mockReturnValueOnce("u");
        argonHashMock.mockResolvedValueOnce("H");
        sendMock.mockRejectedValueOnce(new Error("boom"));

        const response = await registerUserHandler({
            body: JSON.stringify({
                email: "x@test.com",
                password: "StrongPwd123!",
            }),
        });

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INTERNAL_ERROR",
        });
    });
});
