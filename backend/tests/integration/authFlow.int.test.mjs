// backend/tests/integration/authFlow.int.test.mjs
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { getUserProfileByUserId } from "../testDbRequest/get.js";
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
            firstName: TEST_FIRSTNAME,
            lastName: TEST_LASTNAME,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-registerUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        const response = decode(payload.Payload);

        console.log("RegisterUser Lambda response:", response);

        expect(response.statusCode).toBe(201);
        expect(response.body.ok).toBe(true);
        expect(response.body.userId).toBeDefined();
        expect(response.body.message).toBe("user successfully created");
        expect(response.body.accessToken).toBeDefined();
        console.log("RegisterUser Lambda response body:", response.body.accessToken);

        userId = response.body.userId;
        console.log("Created userId:", userId);

        await new Promise(resolve => setTimeout(resolve, 3000));
        const profileAfterCreation = await getUserProfileByUserId(userId);
        expect(profileAfterCreation).toBeDefined();
        expect(profileAfterCreation.email).toBe(TEST_EMAIL);
        expect(profileAfterCreation.firstName).toBe(TEST_FIRSTNAME);
        expect(profileAfterCreation.lastName).toBe(TEST_LASTNAME);
    });

    // 2) Connexion
    it("devrait permettre de se connecter avec les bons identifiants", async () => {

        const body = {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-loginUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        const response = decode(payload.Payload);

        console.log("LoginUser Lambda response:", response);
        console.log("Logged in accessToken:", response.body.accessToken);

        userId = response.body.userId;

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body.userId).toBeDefined();
        expect(response.body.ok).toBe(true);
        expect(response.headers["Set-Cookie"]).toBeDefined();
        expect(response.body.message).toBe("LOGGED_IN");

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
                FunctionName: `site-asso-api-${process.env.STAGE}-updateAuthUser`,
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    body: JSON.stringify(body)
                })),
            })
        );

        const response = decode(payload.Payload);

        console.log("UpdateAuthUser Lambda response:", response);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.updated).toStrictEqual({ email: true, profile: true })

        await new Promise(resolve => setTimeout(resolve, 3000));
        const updatedProfile = await getUserProfileByUserId(userId);
        console.log("updatedProfile", updatedProfile);
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
                FunctionName: `site-asso-api-${process.env.STAGE}-updateAuthUserPassword`,
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    body: JSON.stringify(body)
                })),
            })
        );

        let response = decode(payload.Payload);

        console.log("UpdateAuthUserPassword Lambda response:", response);

        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);

        body = {
            email: TEST_NEW_EMAIL,
            password: TEST_PASSWORD, // ancien password, doit échouer
        }

        payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-loginUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        response = decode(payload.Payload);

        console.log("LoginUser Lambda response (wrong password):", response);

        expect(response.statusCode).toBe(403); // WRONG_CREDENTIALS attendu
        expect(response.body.ok).toBe(false);
        expect(response.body.message).toBe("WRONG_CREDENTIALS");

        body = {
            email: TEST_NEW_EMAIL,
            password: TEST_NEW_PASSWORD, // nouveau password, doit réussir
        }

        // le nouveau fonctionne
        payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-loginUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(body) })),
            })
        );

        response = decode(payload.Payload);

        console.log("LoginUser Lambda response (new password):", response);

        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.message).toBe("LOGGED_IN");
        expect(response.body.userId).toBe(userId);
    });

    // 5) Suppression du user
    it("devrait permettre de supprimer le user", async () => {
        const body = {
            email: TEST_NEW_EMAIL,
            password: TEST_NEW_PASSWORD,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-removeAuthUser`,
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    body: JSON.stringify(body)
                })),
            })
        );

        const response = decode(payload.Payload);

        console.log("RemoveAuthUser Lambda response:", response);

        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.message).toBe("User removed");

        await new Promise(resolve => setTimeout(resolve, 3000));
        const profileAfterDelete = await getUserProfileByUserId(userId);
        console.log("profileAfterDelete", profileAfterDelete);
        expect(profileAfterDelete).toBeUndefined();
    });

});
