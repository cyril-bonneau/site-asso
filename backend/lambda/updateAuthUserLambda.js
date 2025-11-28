import { json } from "../helpers/toolbox.js";
import { normalizeEmail } from "../helpers/toolbox.js";
import { addUserProfileUpdateOperation } from "../dal/addUserProfileUpdateOperation.js"
import { sendTransactToDb } from "../dal/requestToDb.js"

export const handler = async (event) => {
    try {
        const userId = event?.queryStringParameters?.id;

        if (!userId) {
            return json(400, { ok: false, message: "MISSING_USER_ID" });
        }

        let data;

        try {
            data = JSON.parse(event.body);
        } catch {
            return json(400, { ok: false, message: "INVALID_JSON_BODY" });
        }

        const oldEmail = data.oldEmail ? normalizeEmail(data.oldEmail) : undefined;
        const newEmail = data.newEmail ? normalizeEmail(data.newEmail) : undefined;
        const firstName = data.firstName;
        const lastName = data.lastName;

        const hasEmailChange =
            oldEmail && newEmail && oldEmail !== newEmail;
        const hasProfileChange =
            firstName !== undefined || lastName !== undefined;

        if (!hasEmailChange && !hasProfileChange) {
            return json(200, { ok: true, message: "NOTHING_TO_UPDATE" });
        }

        return await updateUserTransactional({
            userId,
            oldEmail,
            newEmail,
            firstName,
            lastName,
            hasEmailChange,
            hasProfileChange,
        });

    } catch (err) {
        console.error("Error in updateUser handler:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
};

async function updateUserTransactional(params) {
    const {
        userId,
        oldEmail,
        newEmail,
        firstName,
        lastName,
        hasEmailChange,
        hasProfileChange,
    } = params;

    const transactItems = [];

    const addUserProfileUpdateOperationResult = addUserProfileUpdateOperation({
        userId,
        oldEmail,
        newEmail,
        firstName,
        lastName,
        hasEmailChange,
        hasProfileChange
    });
    console.log("type addUserProfileUpdateOperationResult", typeof addUserProfileUpdateOperationResult, Array.isArray(addUserProfileUpdateOperationResult));
    transactItems.push(...addUserProfileUpdateOperationResult)
    console.log("transactItems hasEmailChange", transactItems)

    if (transactItems.length === 0) {
        return json(200, { ok: true, message: "NOTHING_TO_UPDATE" });
    }

    try {
        console.log("Executing TransactWrite for user:", userId, {
            hasEmailChange,
            hasProfileChange,
            opsCount: transactItems.length,
        });

        console.log("final transactItems", transactItems)

        await sendTransactToDb(transactItems)

        console.info("User update transaction successful for user:", userId);

        return json(200, {
            ok: true,
            updated: {
                email: hasEmailChange,
                profile: hasProfileChange
            }
        });
    } catch (err) {
        const errorName = err?.name || "";
        const msg = err?.message || "";

        if (
            errorName === "TransactionCanceledException" ||
            msg.includes("ConditionalCheckFailed")
        ) {
            return json(409, {
                ok: false,
                message: "EMAIL_ALREADY_IN_USE",
                meta: { email: newEmail },
            });
        }

        console.error("Error in updateUserEmail transaction:", err);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}
