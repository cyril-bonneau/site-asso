import { sendTransactToDb } from "../dal/requestToDb";

const USER_TABLE = process.env.USER_TABLE;

const isoNow = () => new Date().toISOString();

const RETRYABLE = new Set([
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "InternalServerError",
    "RequestLimitExceeded",
    "LimitExceededException",
]);

// ----- handler de stream -----
export const handler = async (event) => {
    try {

        if (event.source !== "site-asso.auth.register" || event["detail-type"] !== "UserRegistered") {
            console.error("onRegisterAuthStream: événement inattendu", {
                Source: event.source,
                DetailType: event["detail-type"]
            });
            throw new Error("onRegisterAuthStream: événement inattendu");
        }

        const { userId, email, firstName, lastName } = event.detail;

        if (!email || !userId || !firstName || !lastName) {
            console.error("onRegisterAuthStream: info manquante dans l'événement", { eventDetail: event.detail });
            throw new Error("onRegisterAuthStream: info manquante dans l'événement");
        }

        await createUserWithUniqueEmail({ email, firstName, lastName, userId });

    } catch (err) {
        if (err?.name === "ConditionalCheckFailedException") {
            console.info("onRegisterAuthStream: déjà présent (idempotent), abandon");
            return
        }

        // Erreurs réessayables → on *throw* pour que l'ESM retry/bisect/DLQ fasse son job
        if (RETRYABLE.has(err?.name)) {
            console.warn("onRegisterAuthStream: erreur réessayable → retry ESM", { name: err?.name });
            throw err;
        }

        // Autres erreurs : on log et on *throw* (ira en DLQ après quelques retries ESM)
        console.error("onRegisterAuthStream: erreur non-idempotente", { name: err?.name, message: err?.message });
        throw err;
    }
};

async function createUserWithUniqueEmail({ email, firstName, lastName, userId } = {}) {
    const now = isoNow();

    const emailLockItem = {
        PK: `EMAIL#${email}`,
        SK: "UNIQUE",
        userId: userId,
        createdAt: now,
    };

    const userItem = {
        PK: `USER#${userId}`,
        SK: `PROFILE#${userId}`,
        GSI1PK: 'USER#EMAIL',
        GSI1SK: email,
        userId: userId,
        email: email,
        firstName: firstName,
        lastName: lastName,
        createdAt: now,
        updatedAt: now,
    };

    const transact = [
        {
            Put: {
                TableName: USER_TABLE,
                Item: emailLockItem,
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        },
        {
            Put: {
                TableName: USER_TABLE,
                Item: userItem,
                ConditionExpression: "attribute_not_exists(PK)",
                ReturnValuesOnConditionCheckFailure: "ALL_OLD",
            },
        }
    ];

    try {
        await sendTransactToDb(transact, true);
    } catch (err) {
        if (err?.name === "ConditionalCheckFailedException") {
            console.warn("onRegisterAuthStream: déjà présent (idempotent), on continue");
            return;
        }
        throw err; // retryables ou inconnues
    }

    // Succès : les 2 Put sont passés
    console.info("onRegisterAuthStream: projection OK", { userId, email });
}
