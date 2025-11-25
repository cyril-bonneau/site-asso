// backend/tests/integration/logInAuthUser.int.test.mjs
import { describe, it, expect } from "vitest";
import { invokeLambda, createTestUser } from "./intTestUtils.mjs";
import { handler as loginHandler } from "../../lambda/logInAuthUserLambda.js";

describe("logInAuthUserLambda (intégration)", () => {
    it("400 INVALID_JSON_BODY quand le body n'est pas du JSON", async () => {
        const { statusCode, body } = await invokeLambda(loginHandler, {
            rawBody: "{ this is not json",
            ipLabel: "login-invalid-json",
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("Request body must be valid JSON");
    });

    it("400 MISSING_CREDENTIALS si email ou password manquent", async () => {
        const { statusCode, body } = await invokeLambda(loginHandler, {
            body: { email: "test@example.com" },
            ipLabel: "login-missing",
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("MISSING_CREDENTIALS");
    });

    it("403 WRONG_CREDENTIALS pour des identifiants invalides", async () => {
        const { statusCode, body } = await invokeLambda(loginHandler, {
            body: {
                email: `no-user-${Date.now()}@example.com`,
                password: "BadPassw0rd!",
            },
            ipLabel: "login-wrong",
        });

        expect(statusCode).toBe(403);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("WRONG_CREDENTIALS");
    });

    it("500 INTERNAL_ERROR quand l'email n'existe pas", async () => {
        // on n'enregistre volontairement aucun utilisateur
        const event = {
            body: JSON.stringify({
                email: "no-user-here@example.com",
                password: "whatever123!!",
            }),
        };

        const { statusCode, body } = await invokeLambda(
            "logInAuthUserLambda",
            event
        );

        expect(statusCode).toBe(500);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("INTERNAL_ERROR");
    });

    it("200 LOGGED_IN avec des identifiants valides", async () => {
        const { email, password } = await createTestUser({
            suffix: "login-ok",
            passwordLabel: "L1",
        });

        const { statusCode, body } = await invokeLambda(loginHandler, {
            body: { email, password },
            ipLabel: "login-valid",
        });

        expect(statusCode).toBe(200);
        expect(body?.ok).toBe(true);
        expect(body?.message).toBe("LOGGED_IN");
    });

});
