import { json } from "../helpers/toolbox.js";
import { addUserProfileUpdateOperation } from "../dal/addUserProfileUpdateOperation.js"
import { sendTransactToDb } from "../dal/requestToDb.js"
import { getEmailByUserId } from "../dal/getEmailByUserId.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";
import { validateInput } from "../zod/validateInput.js";
import { updateInputSchema } from "../zod/zodSchema/updateInputValidation.js";

export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
})

async function handlerCore(event, context, { auth }) {
    try {
        const { userId } = auth;
        let email;

        try {
            ({ email, firstName, lastName } = await getEmailByUserId(userId));
            console.log('email fetched by userId:', email);
        } catch (err) {
            console.error("Error fetching email by userId:", err);
            return json(400, { ok: false, message: "USER_NOT_FOUND" });
        }

        if (!userId) {
            return json(400, { ok: false, message: "MISSING_USER_ID" });
        }

        const input = validateInput(event, updateInputSchema);

        if (!input.ok) {
            console.log("Input validation failed:", input.body.message);
            return json(input.statusCode, { ok: false, message: input.body.message });
        }

        const { newEmail, newFirstName, newLastName } = input.body.data;

        const hasEmailChange =
            newEmail && email !== newEmail;
        const hasProfileChange =
            (newFirstName !== undefined && firstName !== newFirstName) || (newLastName !== undefined && lastName !== newLastName);

        if (!hasEmailChange && !hasProfileChange) {
            return json(200, { ok: true, message: "NOTHING_TO_UPDATE" });
        }

        return await updateUserTransactional({
            userId,
            oldEmail: email,
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
    console.log("updateUserTransactional called with:", { oldEmail, newEmail, firstName, lastName, hasEmailChange, hasProfileChange });

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
