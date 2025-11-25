// backend/tests/integration/updatePassword.int.test.mjs
import { describe, it, expect } from "vitest";
import {
    invokeLambda,
    createTestUser,
    getAuthEmailEntry,
    extractLogicalUserIdFromAuthEmail,
} from "./intTestUtils.mjs";
import { handler as updatePwdHandler } from "../../lambda/updateAuthUserPasswordLambda.js";
import { handler as loginHandler } from "../../lambda/logInAuthUserLambda.js";

async function getUserIdByEmail(email) {
    const emailEntry = await getAuthEmailEntry(email);
    if (!emailEntry) throw new Error(`Auth EMAIL entry non trouvée pour ${email}`);
    return extractLogicalUserIdFromAuthEmail(emailEntry);
}

describe("updateAuthUserPasswordLambda (intégration)", () => {
    it("400 MISSING_USER_ID si query param id absent", async () => {
        const { statusCode, body } = await invokeLambda(updatePwdHandler, {
            body: { oldPassword: "x", newPassword: "y" },
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("MISSING_USER_ID");
    });

    it("400 INVALID_JSON_BODY si body n'est pas du JSON", async () => {
        const { email } = await createTestUser({
            suffix: "pwd-invalid",
            passwordLabel: "P1",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(updatePwdHandler, {
            rawBody: "{ this is not json",
            query: { id: userId },
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("INVALID_JSON_BODY");
    });

    it("400 MISSING_PASSWORD_FIELDS si un seul des deux champs est fourni", async () => {
        const { email } = await createTestUser({
            suffix: "pwd-missing",
            passwordLabel: "P2",
        });
        const userId = await getUserIdByEmail(email);

        const onlyOld = await invokeLambda(updatePwdHandler, {
            query: { id: userId },
            body: { oldPassword: "Something" },
        });
        expect(onlyOld.statusCode).toBe(400);
        expect(onlyOld.body?.ok).toBe(false);
        expect(onlyOld.body?.message).toBe("MISSING_PASSWORD_FIELDS");

        const onlyNew = await invokeLambda(updatePwdHandler, {
            query: { id: userId },
            body: { newPassword: "SomethingElse" },
        });
        expect(onlyNew.statusCode).toBe(400);
        expect(onlyNew.body?.ok).toBe(false);
        expect(onlyNew.body?.message).toBe("MISSING_PASSWORD_FIELDS");
    });

    it("200 NOTHING_TO_UPDATE si aucun changement n'est demandé", async () => {
        const { email } = await createTestUser({
            suffix: "pwd-nothing",
            passwordLabel: "P3",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(updatePwdHandler, {
            query: { id: userId },
            body: {}, // oldPassword/newPassword undefined
        });

        expect(statusCode).toBe(200);
        expect(body?.ok).toBe(true);
        expect(body?.message).toBe("NOTHING_TO_UPDATE");
    });

    it("403 WRONG_PASSWORD si l'ancien mot de passe est incorrect", async () => {
        const { email } = await createTestUser({
            suffix: "pwd-wrong",
            passwordLabel: "P4",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(updatePwdHandler, {
            query: { id: userId },
            body: {
                oldPassword: "TotallyWrong",
                newPassword: "NewStr0ng!Pass",
            },
        });

        expect(statusCode).toBe(403);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("WRONG_PASSWORD");
    });

    it(
        "200 PASSWORD_UPDATED, login échoue avec l'ancien mot de passe et réussit avec le nouveau",
        async () => {
            const { email, password: oldPassword } = await createTestUser({
                suffix: "pwd-success",
                passwordLabel: "P5",
            });
            const userId = await getUserIdByEmail(email);
            const newPassword = `NewStr0ng!Passw0rd-${Date.now()}`;

            const changeRes = await invokeLambda(updatePwdHandler, {
                query: { id: userId },
                body: { oldPassword, newPassword },
            });

            expect(changeRes.statusCode).toBe(200);
            expect(changeRes.body?.ok).toBe(true);
            expect(changeRes.body?.message).toBe("PASSWORD_UPDATED");

            const loginOld = await invokeLambda(loginHandler, {
                body: { email, password: oldPassword },
                ipLabel: "pwd-login-old",
            });
            expect(loginOld.statusCode).toBe(403);
            expect(loginOld.body?.ok).toBe(false);
            expect(loginOld.body?.message).toBe("WRONG_CREDENTIALS");

            const loginNew = await invokeLambda(loginHandler, {
                body: { email, password: newPassword },
                ipLabel: "pwd-login-new",
            });
            expect(loginNew.statusCode).toBe(200);
            expect(loginNew.body?.ok).toBe(true);
            expect(loginNew.body?.message).toBe("LOGGED_IN");
        },
    );
});
