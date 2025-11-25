// backend/tests/integration/updateAuthUser.int.test.mjs
import { describe, it, expect } from "vitest";
import {
    invokeLambda,
    createTestUser,
    getAuthEmailEntry,
    extractLogicalUserIdFromAuthEmail,
    getUserProfileEntry,
    getUserEmailEntry,
} from "./intTestUtils.mjs";
import { handler as updateUserHandler } from "../../lambda/updateAuthUserLambda.js";
import { handler as loginHandler } from "../../lambda/logInAuthUserLambda.js";

async function getUserIdByEmail(email) {
    const emailEntry = await getAuthEmailEntry(email);
    if (!emailEntry) throw new Error(`Auth EMAIL entry non trouvée pour ${email}`);
    return extractLogicalUserIdFromAuthEmail(emailEntry);
}

describe("updateAuthUserLambda (intégration)", () => {
    it("400 MISSING_USER_ID si query param id absent", async () => {
        const { statusCode, body } = await invokeLambda(updateUserHandler, {
            body: { oldEmail: "a@b.c", newEmail: "c@d.e" },
            // pas de query.id
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("MISSING_USER_ID");
    });

    it("400 INVALID_JSON_BODY si body non JSON", async () => {
        const { email } = await createTestUser({
            suffix: "upd-invalid",
            passwordLabel: "U1",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(updateUserHandler, {
            rawBody: "{ this is not json",
            query: { id: userId },
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("INVALID_JSON_BODY");
    });

    it("200 NOTHING_TO_UPDATE si aucun changement effectif", async () => {
        const { email } = await createTestUser({
            suffix: "upd-nothing",
            passwordLabel: "U2",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(updateUserHandler, {
            query: { id: userId },
            body: { oldEmail: email, newEmail: email },
        });

        expect(statusCode).toBe(200);
        expect(body?.ok).toBe(true);
        expect(body?.message).toBe("NOTHING_TO_UPDATE");
    });

    it("200 updated.profile=true pour update du profil uniquement", async () => {
        const { email } = await createTestUser({
            suffix: "upd-profile",
            passwordLabel: "U3",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(updateUserHandler, {
            query: { id: userId },
            body: {
                oldEmail: email,
                newEmail: email,
                firstName: "Jack",
                lastName: "ProfileOnly",
            },
        });

        expect(statusCode).toBe(200);
        expect(body?.ok).toBe(true);
        expect(body?.updated?.email).toBe(false);
        expect(body?.updated?.profile).toBe(true);

        const profile = await getUserProfileEntry(userId);
        expect(profile).not.toBeNull();
        expect(profile.firstName).toBe("Jack");
        expect(profile.lastName).toBe("ProfileOnly");
        expect(profile.email).toBe(email);
    });

    it(
        "200 updated.email=true + updated.profile=true, login avec nouveau mail OK, ancien KO",
        async () => {
            const { email: oldEmail, password } = await createTestUser({
                suffix: "upd-email",
                passwordLabel: "U4",
            });
            const userId = await getUserIdByEmail(oldEmail);
            const newEmail = `updated-${Date.now()}@example.com`.toLowerCase();

            const { statusCode, body } = await invokeLambda(updateUserHandler, {
                query: { id: userId },
                body: {
                    oldEmail,
                    newEmail,
                    firstName: "Jack",
                    lastName: "EmailUpdated",
                },
            });

            expect(statusCode).toBe(200);
            expect(body?.ok).toBe(true);
            expect(body?.updated?.email).toBe(true);
            expect(body?.updated?.profile).toBe(true);

            const profile = await getUserProfileEntry(userId);
            expect(profile).not.toBeNull();
            expect(profile.email).toBe(newEmail);
            expect(profile.firstName).toBe("Jack");
            expect(profile.lastName).toBe("EmailUpdated");

            const newLock = await getUserEmailEntry(newEmail);
            expect(newLock).not.toBeNull();
            const oldLock = await getUserEmailEntry(oldEmail);
            expect(oldLock).toBeNull();

            const loginNew = await invokeLambda(loginHandler, {
                body: { email: newEmail, password },
                ipLabel: "upd-login-new",
            });
            expect(loginNew.statusCode).toBe(200);
            expect(loginNew.body?.ok).toBe(true);
            expect(loginNew.body?.message).toBe("LOGGED_IN");

            const loginOld = await invokeLambda(loginHandler, {
                body: { email: oldEmail, password },
                ipLabel: "upd-login-old",
            });
            expect(loginOld.statusCode).toBe(403);
            expect(loginOld.body?.message).toBe("WRONG_CREDENTIALS");
        },
    );

    it(
        "409 EMAIL_ALREADY_IN_USE quand on tente de prendre l'email d'un autre utilisateur",
        async () => {
            const userA = await createTestUser({
                suffix: "upd-conf-A",
                passwordLabel: "U5",
            });
            const userB = await createTestUser({
                suffix: "upd-conf-B",
                passwordLabel: "U6",
            });
            const userBId = await getUserIdByEmail(userB.email);

            const { statusCode, body } = await invokeLambda(updateUserHandler, {
                query: { id: userBId },
                body: {
                    oldEmail: userB.email,
                    newEmail: userA.email,
                },
            });

            expect(statusCode).toBe(409);
            expect(body?.ok).toBe(false);
            expect(body?.message).toBe("EMAIL_ALREADY_IN_USE");
            expect(body?.meta?.email).toBe(userA.email);
        },
    );
});
