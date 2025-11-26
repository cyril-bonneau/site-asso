// backend/tests/integration/authFlow.int.test.mjs
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { getUserProfileByUserId } from "../../dal/requestToDb.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { decode } from "../../helpers/toolbox.js";

const client = new LambdaClient({ region: "eu-west-3" });

// === Données de test ===
// email unique à chaque run pour éviter les collisions en dev
const timestamp = Date.now();
const TEST_EMAIL = `cyril.bonneau${timestamp}@outlook.com`;
const TEST_NEW_EMAIL = `cyril.bonneau2${timestamp}@outlook.com`;
const TEST_PASSWORD = "Ax9!qL7#vZ3@pT2";
const TEST_NEW_PASSWORD = "Hy4&nK8@wS6?dR1";
const TEST_FIRSTNAME = "Jack";
const TEST_LASTNAME = "Larnaque";

let userId;

describe("Parcours complet Auth (intégration)", () => {
    // 1) Création de l’utilisateur
    beforeAll(async () => {

        const body = {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-registerUser",
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        const response = decode(payload.Payload);

        console.log("RegisterUser Lambda response:", response);

        expect(response.statusCode).toBe(201);
        expect(response?.ok).toBe(true);
        expect(response?.message).toBe("user successfully created");
    });

    // 2) Connexion
    it("devrait permettre de se connecter avec les bons identifiants", async () => {

        const body = {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-loginUser",
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        const response = decode(payload.Payload);

        userId = response.userId;

        expect(response).toBeDefined();
        expect(response.userId).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response?.ok).toBe(true);
        expect(response?.message).toBe("LOGGED_IN");

    });

    // 3) Update du user (profil / email selon ta logique)
    it("devrait permettre de mettre à jour le profil user", async () => {

        const body = {
            firstName: TEST_FIRSTNAME,
            lastName: TEST_LASTNAME,
            oldEmail: TEST_EMAIL,
            newEmail: TEST_NEW_EMAIL,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-updateAuthUser",
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    body: JSON.stringify(body)
                })),
            })
        );

        const response = decode(payload.Payload);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response?.ok).toBe(true);
        expect(response?.updated).toBe({ email: true, profile: true })

        const updatedProfile = await getUserProfileByUserId(userId);
        expect(updatedProfile).toBeDefined();
        expect(updatedProfile.firstName).toBe(TEST_FIRSTNAME);
        expect(updatedProfile.lastName).toBe(TEST_LASTNAME);
        expect(updatedProfile.email).toBe(TEST_NEW_EMAIL);
    });

    // 4) Changement de mot de passe
    it("devrait permettre de modifier le mot de passe", async () => {

        let body = {
            oldPassword: TEST_PASSWORD,
            newPassword: TEST_NEW_PASSWORD,
        }

        let payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-updateAuthUserPassword",
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    body: JSON.stringify(body)
                })),
            })
        );

        let response = decode(payload.Payload);

        expect(response.statusCode).toBe(200);
        expect(response?.ok).toBe(true);

        body = {
            email: TEST_NEW_EMAIL,
            password: TEST_PASSWORD, // ancien password, doit échouer
        }

        payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-loginUser",
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        response = decode(payload.Payload);

        expect(response.statusCode).toBe(403); // WRONG_CREDENTIALS attendu
        expect(response?.ok).toBe(false);
        expect(response?.message).toBe("WRONG_CREDENTIALS");

        body = {
            email: TEST_NEW_EMAIL,
            password: TEST_NEW_PASSWORD, // nouveau password, doit réussir
        }

        // le nouveau fonctionne
        payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-loginUser",
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        response = decode(payload.Payload);

        expect(response.statusCode).toBe(200);
        expect(response?.ok).toBe(true);
        expect(response?.message).toBe("LOGGED_IN");
        expect(response?.userId).toBe(userId);
    });

    // 5) Suppression du user
    it("devrait permettre de supprimer le user", async () => {
        const body = {
            email: TEST_NEW_EMAIL,
            password: TEST_NEW_PASSWORD,
        }

        payload = await client.send(
            new InvokeCommand({
                FunctionName: "site-asso-api-dev-removeAuthUser",
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    body: JSON.stringify(body)
                })),
            })
        );

        const response = decode(payload.Payload);

        expect(response.statusCode).toBe(200);
        expect(response?.ok).toBe(true);

        const profileAfterDelete = await getUserProfileByUserId(userId);
        expect(profileAfterDelete).toBeUndefined();
    });

    // Optionnel : cleanup défensif
    afterAll(async () => {
        // Si tu veux ajouter une tentative de cleanup même si certains tests échouent,
        // tu peux refaire un call DELETE ici en entourant de try/catch.
    });
});
