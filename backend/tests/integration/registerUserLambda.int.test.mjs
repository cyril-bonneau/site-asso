import { describe, it, beforeAll, expect } from "vitest";
import { getUserProfileByUserId } from "../testDbRequest/get.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { decode } from "../../helpers/toolbox.js";

const client = new LambdaClient({ region: "eu-west-3" });

const timestamp = Date.now();
const EMAIL = `cyril.bonneau${timestamp}@outlook.com`;
const PASSWORD = "Ax9!qL7#vZ3@pT2";
const FIRSTNAME = "Jack";
const LASTNAME = "Larnaque";
const BAD_FIRSTNAME = "J4CK";
const BAD_LASTNAME = "L45N4QUE";

describe.skip("test registerUserLambda", () => {
    it("should register a new user and update the email", async () => {
        // Register a new user
        const payload = {
            email: EMAIL,
            password: PASSWORD,
            firstName: FIRSTNAME,
            lastName: LASTNAME,
        };

        const request = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-registerUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(payload) })),
            })
        );

        const response = decode(request.Payload);

        console.log('Register User Lambda response:', response);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(201);
        expect(response.body.userId).toBeDefined();
        expect(response.body.message).toBe("user successfully created");

        const userId = response.body.userId;
        console.log("Created userId:", userId);

        await new Promise(resolve => setTimeout(resolve, 3000));
        const profileAfterCreation = await getUserProfileByUserId(userId);
        expect(profileAfterCreation).toBeDefined();
        expect(profileAfterCreation.email).toBe(EMAIL);
        expect(profileAfterCreation.firstName).toBe(FIRSTNAME);
        expect(profileAfterCreation.lastName).toBe(LASTNAME);
    })

    it("should fail to register a user with invalid firstName and/or lastName", async () => {
        const payload = {
            email: `invalid${Date.now()}@example.com`,
            password: "ValidPass123!",
            firstName: BAD_FIRSTNAME,
            lastName: BAD_LASTNAME,
        };

        const request = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-registerUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(payload) })),
            })
        );

        const response = decode(request.Payload);

        console.log('Register User Lambda response with invalid names:', response);

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(400);
        expect(response.body.errors).toBeDefined();
        expect(response.body.errors.length).toBeGreaterThan(0);
        expect(response.body.errors.some(error => error.includes("Nom invalide"))).toBe(true);
    })

    afterAll(async () => {
        // Clean up: delete the user from the database

        const payload = {
            email: EMAIL,
            password: PASSWORD,
        }

        const request = await client.send(
            new InvokeCommand({
                FunctionName: `site-asso-api-${process.env.STAGE}-loginUser`,
                Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(payload) })),
            })
        );

        const response = decode(request.Payload);

        let accessToken = response.body.accessToken;

        if (userId) {
            const deleteRequest = await client.send(
                new InvokeCommand({
                    FunctionName: `site-asso-api-${process.env.STAGE}-deleteUser`,
                    Headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                    Payload: Buffer.from(JSON.stringify({ body: JSON.stringify({ userId }) })),
                })
            );

            const deleteResponse = decode(deleteRequest.Payload);
            console.log("Delete User Lambda response:", deleteResponse);
            expect(deleteResponse.body.ok).toBe(true);
            expect(deleteResponse.statusCode).toBe(200);
            expect(deleteResponse.body.message).toBe("User removed");

            await new Promise(resolve => setTimeout(resolve, 3000));
            const profileAfterDelete = await getUserProfileByUserId(userId);
            console.log("profileAfterDelete", profileAfterDelete);
            expect(profileAfterDelete).toBeUndefined();
        }
    });
});