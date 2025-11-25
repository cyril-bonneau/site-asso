import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Mocks hoistés ---

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
    const clientConstructor = vi.fn(() => ({
        send: (...args) => sendMock(...args),
    }));

    class TransactWriteCommand {
        constructor(input) {
            this.input = input;
        }
    }

    return {
        DynamoDBDocumentClient: {
            from: clientConstructor,
        },
        TransactWriteCommand,
        __mocks: {
            sendMock,
            clientConstructor,
        },
    };
});

vi.mock("../../rateLimit/withRateLimit.js", () => ({
    withRateLimit: (handler, _options) => {
        if (typeof handler !== "function") {
            throw new Error("withRateLimit mock: dernier argument non fonction");
        }
        // on renvoie le handler tel quel, sans rate-limit
        return handler;
    },
}));

// --- Imports réels ---

import { handler as registerUserHandler } from "../../lambda/registerUserLambda.js";
import { __mocks as passwordPolicyMocks } from "../../auth/passwordPolicy.js";
import { __mocks as argon2Mocks } from "argon2";
import { __mocks as nanoidMocks } from "nanoid";
import { __mocks as ddbLibMocks } from "@aws-sdk/lib-dynamodb";

const { validatePasswordBackendMock } = passwordPolicyMocks;
const { hashMock: argonHashMock } = argon2Mocks;
const { nanoidMock } = nanoidMocks;
const { sendMock: ddbSendMock } = ddbLibMocks;

describe("registerUserLambda - succès / échec / échec critique", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env.AUTH_TABLE = "AuthTableTest";
    });

    it("Crée un utilisateur et retourne 201", async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true });
        nanoidMock.mockReturnValueOnce("user-123");
        argonHashMock.mockResolvedValueOnce("HASHED_PWD");

        ddbSendMock.mockResolvedValueOnce({
            $metadata: { httpStatusCode: 200 },
        });

        const event = {
            body: JSON.stringify({
                email: "test@example.com",
                password: "StrongPwd123!",
            }),
        };

        const response = await registerUserHandler(event);

        expect(validatePasswordBackendMock).toHaveBeenCalledTimes(1);
        expect(validatePasswordBackendMock).toHaveBeenCalledWith("StrongPwd123!");

        expect(nanoidMock).toHaveBeenCalledTimes(1);

        expect(argonHashMock).toHaveBeenCalledTimes(1);
        expect(argonHashMock).toHaveBeenCalledWith("StrongPwd123!");

        expect(ddbSendMock).toHaveBeenCalledTimes(1);
        const transactCall = ddbSendMock.mock.calls[0][0];
        expect(transactCall.input.TransactItems).toHaveLength(2);

        expect(response.statusCode).toBe(201);
        expect(JSON.parse(response.body)).toEqual({
            ok: true,
            message: "user successfully created",
        });
    });

    it("Retourne 422 si le mot de passe est trop faible", async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({
            ok: false,
            reasons: ["TOO_SHORT", "NO_UPPERCASE"],
        });

        const event = {
            body: JSON.stringify({
                email: "weak@example.com",
                password: "weak",
            }),
        };

        const response = await registerUserHandler(event);

        expect(response.statusCode).toBe(422);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            code: "WEAK_PASSWORD",
            reasons: ["TOO_SHORT", "NO_UPPERCASE"],
        });

        expect(nanoidMock).not.toHaveBeenCalled();
        expect(argonHashMock).not.toHaveBeenCalled();
        expect(ddbSendMock).not.toHaveBeenCalled();
    });

    it("Retourne 400 si le body n’est pas un JSON valide", async () => {
        const event = {
            body: "{not: 'json'}",
        };

        const response = await registerUserHandler(event);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INVALID_JSON_BODY",
        });
    });

    it("Retourne 400 si email ou password manquent", async () => {
        const event = {
            body: JSON.stringify({
                email: "no-password@example.com",
            }),
        };

        const response = await registerUserHandler(event);

        expect(response.statusCode).toBe(400);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "MISSING_CREDENTIALS",
        });
    });

    it("Remonte une erreur 500 si la transaction DynamoDB échoue de façon inattendue", async () => {
        validatePasswordBackendMock.mockResolvedValueOnce({ ok: true });
        nanoidMock.mockReturnValueOnce("user-err");
        argonHashMock.mockResolvedValueOnce("HASHED_ERR");

        ddbSendMock.mockRejectedValueOnce(new Error("Dynamo hard failure"));

        const event = {
            body: JSON.stringify({
                email: "boom@example.com",
                password: "StrongPwd123!",
            }),
        };

        const response = await registerUserHandler(event);

        expect(response.statusCode).toBe(500);
        expect(JSON.parse(response.body)).toEqual({
            ok: false,
            message: "INTERNAL_ERROR",
        });
    });
});
