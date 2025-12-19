import { checkPasswordByUserId } from "../dal/checkPasswordByUserId.js";
import { json } from "../helpers/toolbox.js";
import { sendTransactToDb } from "../dal/requestToDb.js";
import { getEmailByUserId } from "../dal/getEmailByUserId.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";
import { validateInput } from "../zod/validateInput.js";
import { removeInputSchema } from "../zod/zodSchema/removeInputValidation.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
})

async function handlerCore(event, context, { auth }) {

    try {
        const { userId } = auth;

        if (!userId) {
            return json(400, { ok: false, message: "MISSING_USER_ID" });
        }

        let email;

        try {
            email = await getEmailByUserId(userId);
            console.log("email", email);
        } catch (err) {
            console.error("Error fetching email by userId:", err);
            return json(400, { ok: false, message: "USER_NOT_FOUND" });
        }

        const input = validateInput(event, removeInputSchema);
        console.log("input", input);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }

        const { password } = input.body.data;

        await removeAuthUser(userId, email, password);

        return json(200, { ok: true, message: "User removed" });

    } catch (err) {
        if (err.code === "WRONG_PASSWORD") {
            return json(403, { ok: false, message: "WRONG_PASSWORD" });
        }
        console.error("removeAuthUser error", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function removeAuthUser(userId, email, password) {

    const pkAuth = `USER#${userId}`
    const skAuth = "AUTH"
    const pkEmail = `EMAIL#${email}`
    const skEmail = "UNIQUE"

    console.log("pkAuth", pkAuth);
    console.log("pkEmail", pkEmail);

    const test = await checkPasswordByUserId({ password, userId })

    if (!test) {
        const err = new Error("Wrong password");
        err.code = "WRONG_PASSWORD";
        throw err
    }

    const removeRequest = [
        {
            Delete: {
                TableName: AUTH_TABLE,
                Key: { PK: pkAuth, SK: skAuth },
                ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            }
        },
        {
            Delete: {
                TableName: AUTH_TABLE,
                Key: { PK: pkEmail, SK: skEmail },
                ConditionExpression: "attribute_exists(PK) AND attribute_exists(SK)"
            }
        }
    ]

    return await sendTransactToDb(removeRequest)
}