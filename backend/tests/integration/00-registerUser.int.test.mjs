// backend/tests/integration/registerUser.int.test.mjs
import { describe, it, expect } from "vitest";
import {
    invokeLambda,
    getAuthEmailEntry,
    getAuthUserEntry,
    extractLogicalUserIdFromAuthEmail,
    waitForProjection,
} from "./intTestUtils.mjs";
import { handler as registerUserHandler } from "../../lambda/registerUserLambda.js";

describe("registerUserLambda (intégration)", () => {
    it("400 INVALID_JSON_BODY quand le body n'est pas du JSON", async () => {
        const { statusCode, body } = await invokeLambda(registerUserHandler, {
            rawBody: "{ this is not json",
            ipLabel: "reg-invalid-json",
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("INVALID_JSON_BODY");
    });

    it("400 MISSING_CREDENTIALS si email ou password manquent", async () => {
        const { statusCode, body } = await invokeLambda(registerUserHandler, {
            body: { email: "test@example.com" }, // pas de password
            ipLabel: "reg-missing-cred",
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("MISSING_CREDENTIALS");
    });

    it("422 WEAK_PASSWORD si le mot de passe ne respecte pas la politique", async () => {
        const email = `weak-${Date.now()}@example.com`.toLowerCase();

        const { statusCode, body } = await invokeLambda(registerUserHandler, {
            body: { email, password: "123" }, // volontairement trop faible
            ipLabel: "reg-weak",
        });

        expect(statusCode).toBe(422);
        expect(body?.ok).toBe(false);
        expect(body?.code).toBe("WEAK_PASSWORD");
        expect(Array.isArray(body?.reasons)).toBe(true);
    });

    it(
        "201 création OK + AUTH_TABLE + projection USER_TABLE via onAuthStreamLambda",
        async () => {
            const ts = Date.now();
            const email = `reg-int-${ts}@example.com`.toLowerCase();
            const password = `Str0ng!Passw0rd-Reg-${ts}`;

            const { statusCode, body } = await invokeLambda(registerUserHandler, {
                body: { email, password },
                ipLabel: "reg-success",
            });

            expect(statusCode).toBe(201);
            expect(body?.ok).toBe(true);

            const emailEntry = await getAuthEmailEntry(email);
            expect(emailEntry).not.toBeNull();

            const userId = extractLogicalUserIdFromAuthEmail(emailEntry);
            const authEntry = await getAuthUserEntry(userId);
            expect(authEntry).not.toBeNull();
            expect(authEntry.email).toBe(email);

            const { emailItem, profileItem } = await waitForProjection({
                email,
                userId,
            });

            expect(emailItem.userId).toBe(userId);
            expect(profileItem.userId).toBe(userId);
            expect(profileItem.email).toBe(email);
        },
    );

    it("409 EMAIL_ALREADY_EXISTS quand on réutilise le même email", async () => {
        const ts = Date.now();
        const email = `dup-int-${ts}@example.com`.toLowerCase();
        const password = `Str0ng!Passw0rd-Dup-${ts}`;

        const first = await invokeLambda(registerUserHandler, {
            body: { email, password },
            ipLabel: "reg-dup-1",
        });
        expect(first.statusCode).toBe(201);
        expect(first.body?.ok).toBe(true);

        const second = await invokeLambda(registerUserHandler, {
            body: { email, password },
            ipLabel: "reg-dup-2",
        });

        expect(second.statusCode).toBe(409);
        expect(second.body?.ok).toBe(false);
        expect(second.body?.error).toBe("EMAIL_ALREADY_EXISTS");
    });
});
