// backend/tests/integration/removeAuthUser.int.test.mjs
import { describe, it, expect } from "vitest";
import {
    invokeLambda,
    createTestUser,
    getAuthEmailEntry,
    extractLogicalUserIdFromAuthEmail,
    getAuthUserEntry,
    getUserEmailEntry,
    getUserProfileEntry,
    waitForDeletion,
} from "./intTestUtils.mjs";
import { handler as removeHandler } from "../../lambda/removeAuthUserLambda.js";

async function getUserIdByEmail(email) {
    const emailEntry = await getAuthEmailEntry(email);
    if (!emailEntry) throw new Error(`Auth EMAIL entry non trouvée pour ${email}`);
    return extractLogicalUserIdFromAuthEmail(emailEntry);
}

describe("removeAuthUserLambda (intégration)", () => {
    it("400 INVALID_JSON_BODY quand le body n'est pas du JSON", async () => {
        const { statusCode, body } = await invokeLambda(removeHandler, {
            rawBody: "{ this is not json",
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("INVALID_JSON_BODY");
    });

    it("400 MISSING_CRUCIAL_DATA si email, password ou id manquent", async () => {
        const { statusCode, body } = await invokeLambda(removeHandler, {
            body: { email: "x@y.z", password: "test" }, // pas d'id
        });

        expect(statusCode).toBe(400);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("MISSING_CRUCIAL_DATA");
    });

    it("403 WRONG_PASSWORD si le mot de passe est incorrect", async () => {
        const { email } = await createTestUser({
            suffix: "rem-wrong",
            passwordLabel: "R1",
        });
        const userId = await getUserIdByEmail(email);

        const { statusCode, body } = await invokeLambda(removeHandler, {
            body: {
                email,
                password: "WrongPassw0rd!",
                id: userId,
            },
        });

        expect(statusCode).toBe(403);
        expect(body?.ok).toBe(false);
        expect(body?.message).toBe("WRONG_PASSWORD");
    });

    it(
        "201 User removed + AUTH_TABLE nettoyée + USER_TABLE nettoyée via onRemoveAuthStreamLambda",
        async () => {
            const { email, password } = await createTestUser({
                suffix: "rem-success",
                passwordLabel: "R2",
            });
            const userId = await getUserIdByEmail(email);

            // préconditions
            expect(await getAuthEmailEntry(email)).not.toBeNull();
            expect(await getAuthUserEntry(userId)).not.toBeNull();
            expect(await getUserEmailEntry(email)).not.toBeNull();
            expect(await getUserProfileEntry(userId)).not.toBeNull();

            const { statusCode, body } = await invokeLambda(removeHandler, {
                body: { email, password, id: userId },
            });

            expect(statusCode).toBe(201);
            expect(body?.ok).toBe(true);
            expect(body?.message).toBe("User removed");

            const authEmailAfter = await getAuthEmailEntry(email);
            const authUserAfter = await getAuthUserEntry(userId);
            expect(authEmailAfter).toBeNull();
            expect(authUserAfter).toBeNull();

            await waitForDeletion({ email, userId });

            const userEmailAfter = await getUserEmailEntry(email);
            const userProfileAfter = await getUserProfileEntry(userId);
            expect(userEmailAfter).toBeNull();
            expect(userProfileAfter).toBeNull();
        },
    );
});
