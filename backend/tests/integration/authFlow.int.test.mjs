// backend/tests/integration/authFlow.int.test.mjs
import { describe, it, beforeAll, expect } from "vitest";
import { getUserProfileByUserId } from "../testDbRequest/get.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { decode } from "../../helpers/toolbox.js";

const client = new LambdaClient({ region: "eu-west-3" });

// === Données de test ===
// email unique à chaque run pour éviter les collisions en dev
const timestamp = Date.now();
const TEST_EMAIL = `cyril.bonneau${timestamp}@outlook.com`;
const TEST_NEW_EMAIL = `cyril.bonneausuccess${timestamp}success@outlook.com`;
const TEST_PASSWORD = "Ax9!qL7#vZ3@pT2";
const TEST_NEW_PASSWORD = "Hy4&nK8@wS6?dR1";
const TEST_FIRSTNAME = "Jack";
const TEST_LASTNAME = "Larnaque";
const TEST_NEW_FIRSTNAME = "Jackson";
const TEST_NEW_LASTNAME = "Larnoque";

let userId;
let accessToken;
let accessToken2;
let refreshToken;

describe("Parcours complet Auth (intégration)", () => {
    it("devrait créer un utilisateur avec succès", async () => {
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

        userId = response.body.userId;
        console.log("Created userId:", userId);

        await new Promise(resolve => setTimeout(resolve, 3000));
        const profileAfterCreation = await getUserProfileByUserId(userId);
        expect(profileAfterCreation).toBeDefined();
        expect(profileAfterCreation.email).toBe(TEST_EMAIL);
        expect(profileAfterCreation.firstName).toBe(TEST_FIRSTNAME);
        expect(profileAfterCreation.lastName).toBe(TEST_LASTNAME);
    }, 30000); // timeout de 30 secondes pour la création d'utilisateur

    // 2) Connexion
    it.skip("devrait permettre de se connecter avec les bons identifiants", async () => {

        const payload = {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
        }

        const request = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-loginUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(payload) })),
            })
        );

        const response = decode(request.Payload);

        console.log("LoginUser Lambda response:", response);
        console.log("Logged in accessToken:", response.body.accessToken);

        accessToken = response.body.accessToken;
        userId = response.body.userId;

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body.userId).toBeDefined();
        expect(response.body.ok).toBe(true);
        expect(response.body.accessToken).toBeDefined();
        expect(response.cookies[0]).toBeDefined();
        expect(response.body.message).toBe("LOGGED_IN");

    });

    // 3) Update du user (profil / email)
    it.skip("devrait permettre de mettre à jour le profil user", async () => {

        const body = {
            newEmail: TEST_NEW_EMAIL,
            newFirstName: TEST_NEW_FIRSTNAME,
            newLastName: TEST_NEW_LASTNAME,
        }

        console.log('body.newEmail', body.newEmail);

        let headers = {
            Authorization: `Bearer ${accessToken}`,
            Cookie: refreshToken,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-updateAuthUser`,
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    headers: headers,
                    body: JSON.stringify(body),
                })),
            })
        );

        let response = decode(payload.Payload);

        console.log("UpdateAuthUser Lambda response:", response);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
        expect(response.body.updated).toStrictEqual({ email: true, profile: true })

        await new Promise(resolve => setTimeout(resolve, 3000));
        const updatedProfile = await getUserProfileByUserId(userId);
        console.log("updatedProfile", updatedProfile);
        expect(updatedProfile).toBeDefined();
        expect(updatedProfile.firstName).toBe(TEST_NEW_FIRSTNAME);
        expect(updatedProfile.lastName).toBe(TEST_NEW_LASTNAME);
        expect(updatedProfile.email).toBe(TEST_NEW_EMAIL);

        headers = {
            Authorization: `Bearer ${accessToken}`,
            Cookie: refreshToken,
        }

        const payload2 = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-updateAuthUser`,
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    headers: headers,
                    body: JSON.stringify(body),
                })),
            })
        );

        console.log('body.newEmail after update', body.newEmail);
        response = decode(payload2.Payload);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);
        console.log("response body message", response.body.message);
        expect(response.body.message).toStrictEqual("NOTHING_TO_UPDATE");

    });

    // 4) Changement de mot de passe
    it.skip("devrait permettre de modifier le mot de passe", async () => {

        let body = {
            oldPassword: TEST_PASSWORD,
            newPassword: TEST_NEW_PASSWORD,
        }

        const headers = {
            Authorization: `Bearer ${accessToken}`,
            Cookie: refreshToken,
        }

        let payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-updateAuthUserPassword`,
                Payload: Buffer.from(JSON.stringify({
                    queryStringParameters: { id: userId },
                    headers: headers,
                    body: JSON.stringify(body)
                })),
            })
        );

        let response = decode(payload.Payload);

        console.log("UpdateAuthUserPassword Lambda response:", response);
        console.log("access token", accessToken);
        console.log("refresh token", refreshToken);

        console.log("response statusCode", response.statusCode);
        console.log("response body", response.body);

        expect(response.statusCode).toBe(200);
        expect(response.body.ok).toBe(true);

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

    it.skip("devrait échouer à la connexion avec l'ancien mot de passe", async () => {
        const payload = {
            email: TEST_EMAIL,
            password: TEST_PASSWORD, // ancien mot de passe, doit échouer
        }

        const request = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-loginUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(payload) })),
            })
        );

        const response = decode(request.Payload);

        console.log("LoginUser Lambda response (old password):", response);
        expect(response.statusCode).toBe(401);
        expect(response.body.ok).toBe(false);
        expect(response.body.message).toBe("INVALID_CREDENTIALS");
    })

    // 5) Suppression du user
    it.skip("devrait permettre de supprimer le user", { timeout: 10000 }, async () => {

        const body = {
            password: TEST_NEW_PASSWORD,
        }

        const headers = {
            Authorization: `Bearer ${accessToken}`,
            Cookie: refreshToken,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-removeAuthUser`,
                Payload: Buffer.from(JSON.stringify({
                    headers: headers,
                    body: JSON.stringify(body),
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
