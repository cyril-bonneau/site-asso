import { updatePasswordCore } from "../dal/updatePasswordCore.js"
import { json } from "../helpers/json.js";

import { sendUpdateToDb } from "../dal/requestToDb.js";

export const handler = async (event) => {
    try {
        const userId = event?.queryStringParameters?.id;
        if (!userId) {
            return json(400, { ok: false, message: "MISSING_USER_ID" });
        }

        let data;
        try {
            data = JSON.parse(event.body || "{}");
        } catch {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" });
        }

        const oldPassword = data.oldPassword;
        const newPassword = data.newPassword

        const hasPasswordChange =
            oldPassword && newPassword;

        if ((oldPassword !== undefined) !== (newPassword !== undefined)) {
            return json(400, { ok: false, message: "MISSING_PASSWORD_FIELDS" });
        }

        if (!hasPasswordChange) {
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

// const updatePassword = withRateLimit(updatePasswordCore, {
//     scope: "updatePassword",
//     capacity: 3,
//     keySelector: ({ userId }) => `USER#${userId}`
// })