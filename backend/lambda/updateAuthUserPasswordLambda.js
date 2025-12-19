import { updatePasswordCore } from "../dal/updatePasswordCore.js"
import { json } from "../helpers/toolbox.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";
import { sendUpdateToDb } from "../dal/requestToDb.js";
import { validateInput } from "../zod/validateInput.js";
import { passwordUpdateInputSchema } from "../zod/zodSchema/updatePasswordInputValidation.js";

export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
})

async function handlerCore(event, context, { auth }) {
    try {
        const { userId } = auth;

        if (!userId) {
            return json(400, { ok: false, message: "MISSING_USER_ID" });
        }

        const input = validateInput(event, passwordUpdateInputSchema);

        if (!input.ok) {
            return json(input.statusCode, { ok: false, message: input.body.message });
        }

        const { oldPassword, newPassword } = input.body.data;

        if (oldPassword === newPassword) {
            return json(200, { ok: true, message: "NOTHING_TO_UPDATE" });
        }

        return await passwordManager({
            userId,
            oldPassword,
            newPassword
        });

    } catch (err) {
        console.error("Error in updateUser handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function passwordManager({
    userId,
    oldPassword,
    newPassword
}) {
    try {
        const updatePasswordResult = await updatePasswordCore({
            userId,
            oldPassword,
            newPassword
        })
        const resp = await sendUpdateToDb(updatePasswordResult)

        console.log("resp", resp);

        return json(200, { ok: true, message: "PASSWORD_UPDATED" })

    } catch (err) {
        if (err.code === "WRONG_PASSWORD") {
            return json(403, { ok: false, message: "WRONG_PASSWORD" });
        }
        throw err;
    }
}