import { describe, it, beforeAll, expect } from "vitest";
import { getUserProfileByUserId } from "../testDbRequest/get.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { decode } from "../../helpers/toolbox.js";

const client = new LambdaClient({ region: "eu-west-3" });

// === Données de test ===
// email unique à chaque run pour éviter les collisions en dev
const timestamp = Date.now();
const TEST_EMAIL = `cyril.bonneau${timestamp}@outlook.com`;
const TEST_PASSWORD = "Ax9!qL7#vZ3@pT2";
const TEST_FIRSTNAME = "Jack";
const TEST_LASTNAME = "Larnaque";

let userId;
let accessToken;
let refreshToken;

describe("Parcours complet création d'association (intégration)", () => {
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

        accessToken = response.body.accessToken;
        refreshToken = response.headers["Set-Cookie"];

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

    it("devrait permettre de créer la base d'une association", async () => {

        const body = {
            name: `Association de test ${timestamp}`,
            description: "Cette association est un test pour la lambda de création de fiche d'associaction.",
            type: "association",
            postalCode: "94450"
        }

        let headers = {
            Authorization: `Bearer ${accessToken}`,
            Cookie: refreshToken,
        }

        const payload = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-addAsso`,
                Payload: Buffer.from(JSON.stringify({
                    headers: headers,
                    body: JSON.stringify(body),
                })),
            })
        );

        const response = decode(payload.Payload);

        console.log("addAsso Lambda response:", response);
        console.log("Logged in accessToken:", response.body.accessToken);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(201);
        expect(response.body.ok).toBe(true);
        expect(response.body.data.assoId).toBeDefined();

    });
})