import { checkPasswordByUserId } from "../dal/checkPasswordByUserId.js";
import { json } from "../helpers/toolbox.js";
import { sendTransactToDb } from "../dal/requestToDb.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";

const AUTH_TABLE = process.env.AUTH_TABLE;

export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
})

async function handlerCore(event) {
    let data
    try {

        const id = event?.queryStringParameters?.id;
        try {
            data = JSON.parse(event.body)
        } catch (err) {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" })
        }

        const { email, password } = data

        if (!email || !password || !id) {
            return json(400, { ok: false, message: "MISSING_CRUCIAL_DATA" })
        }

        await removeAuthUser(id, email, password);

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