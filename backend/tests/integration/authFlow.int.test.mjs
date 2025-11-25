// backend/tests/integration/authFlow.int.test.mjs
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { callApi, getUserProfileByUserId } from "./config.int.mjs";

// === Données de test ===
// email unique à chaque run pour éviter les collisions en dev
const timestamp = Date.now();
const TEST_EMAIL = `int-user-${timestamp}@example.com`;
const TEST_PASSWORD = "Ax9!qL7#vZ3@pT2";
const TEST_NEW_PASSWORD = "Hy4&nK8@wS6?dR1";
const TEST_FIRSTNAME = "Jack";
const TEST_LASTNAME = "Larnaque";
const TEST_NEW_FIRSTNAME = "Jacky";  // pour le update
const TEST_NEW_LASTNAME = "Larnaque-Pro";

let userId; // sera rempli après register

describe("Parcours complet Auth (intégration)", () => {
    // 1) Création de l’utilisateur
    beforeAll(async () => {
        const { status, body } = await callApi("PUT", "/registerUser", {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
            firstname: TEST_FIRSTNAME,
            lastname: TEST_LASTNAME,
        });
        // ⚠️ adapte si tu renvoies 200 au lieu de 201
        expect([200, 201]).toContain(status);
        expect(body?.ok).toBe(true);

        // ⚠️ Assumption : la lambda retourne userId
        //  à adapter avec le vrai nom de propriété
        expect(body?.userId).toBeDefined();
        userId = body.userId;

        // Vérification en base dans USER_TABLE
        const userProfile = await getUserProfileByUserId(userId);
        expect(userProfile).toBeDefined();
        expect(userProfile.email).toBeDefined();
        // Si tu stockes l’email normalisé :
        // expect(userProfile.email).toBe(normalizeEmail(TEST_EMAIL)) (si tu l’exportes un jour)
    });

    // 2) Connexion
    it("devrait permettre de se connecter avec les bons identifiants", async () => {
        const { status, body } = await callApi("POST", "/login", {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });

        expect(status).toBe(200);
        expect(body?.ok).toBe(true);
        // ⚠️ Assumption : message LOGGED_IN (vu dans ton ancien code)
        expect(body?.message).toBe("LOGGED_IN");

        // À adapter si tu renvoies des tokens :
        // expect(body.accessToken).toBeDefined();
        // expect(body.refreshToken).toBeDefined();
        // expect(body.userId).toBe(userId);
    });

    // 3) Update du user (profil / email selon ta logique)
    it("devrait permettre de mettre à jour le profil user", async () => {
        const { status, body } = await callApi("PATCH", "/updateUser", {
            userId,
            firstname: TEST_NEW_FIRSTNAME,
            lastname: TEST_NEW_LASTNAME,
            // Ajoute ici email si ton updateAuthUserLambda gère aussi l’email
            // newEmail: TEST_NEW_EMAIL
        });

        expect(status).toBe(200);
        expect(body?.ok).toBe(true);
        // Assumption :
        // expect(body?.message).toBe("USER_UPDATED");

        const updatedProfile = await getUserProfileByUserId(userId);
        expect(updatedProfile).toBeDefined();
        expect(updatedProfile.firstname).toBe(TEST_NEW_FIRSTNAME);
        expect(updatedProfile.lastname).toBe(TEST_NEW_LASTNAME);
    });

    // 4) Changement de mot de passe
    it("devrait permettre de modifier le mot de passe", async () => {
        const { status, body } = await callApi("PATCH", "/updatePassword", {
            userId,
            oldPassword: TEST_PASSWORD,
            newPassword: TEST_NEW_PASSWORD,
        });

        expect(status).toBe(200);
        expect(body?.ok).toBe(true);
        // Assumption :
        // expect(body?.message).toBe("PASSWORD_UPDATED");

        // vérif : l'ancien mot de passe ne fonctionne plus
        const { status: statusOld, body: bodyOld } = await callApi("GET", "/login", {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        });
        expect(statusOld).toBe(403); // WRONG_CREDENTIALS attendu
        expect(bodyOld?.ok).toBe(false);
        expect(bodyOld?.message).toBe("WRONG_CREDENTIALS");

        // le nouveau fonctionne
        const { status: statusNew, body: bodyNew } = await callApi("get", "/login", {
            email: TEST_EMAIL,
            password: TEST_NEW_PASSWORD,
        });
        expect(statusNew).toBe(200);
        expect(bodyNew?.ok).toBe(true);
        expect(bodyNew?.message).toBe("LOGGED_IN");
    });

    // 5) Suppression du user
    it("devrait permettre de supprimer le user", async () => {
        const { status, body } = await callApi("DELETE", "/removeAuthUser", {
            userId,
            password: TEST_NEW_PASSWORD, // ou oldPassword selon ta lambda removeAuthUser
        });

        expect(status).toBe(200);
        expect(body?.ok).toBe(true);
        // Assumption :
        // expect(body?.message).toBe("USER_REMOVED");

        // Vérification : plus de profil dans USER_TABLE
        const profileAfterDelete = await getUserProfileByUserId(userId);
        expect(profileAfterDelete).toBeUndefined();
    });

    // Optionnel : cleanup défensif
    afterAll(async () => {
        // Si tu veux ajouter une tentative de cleanup même si certains tests échouent,
        // tu peux refaire un call DELETE ici en entourant de try/catch.
    });
});
