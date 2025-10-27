// addUserLambda.js (ESM)
import { nanoid } from "nanoid";
import {
    DynamoDBClient,
    TransactWriteItemsCommand,
} from "@aws-sdk/client-dynamodb";

const TABLE = process.env.DDB_TABLE;
const ddb = new DynamoDBClient({});

const isoNow = () => new Date().toISOString();

/**
 * Parse finement une TransactionCanceledException pour savoir
 * quelle étape a échoué (EMAIL lock vs USER write).
 */
function parseTxCancel(err) {
    if (err?.name !== "TransactionCanceledException" || !Array.isArray(err?.CancellationReasons)) {
        return null;
    }
    const reasons = err.CancellationReasons;
    const emailReason = reasons[0]?.Code || null; // Put EMAIL#<email>
    const userReason = reasons[1]?.Code || null; // Put USER#<id>
    return { emailReason, userReason, reasonsRaw: reasons };
}

/**
 * Création user avec unicité email garantie par transaction.
 * - EMAIL_ALREADY_EXISTS si verrou déjà présent
 * - Retry (jusqu'à MAX_ID_RETRIES) si collision d'ID
 * - INTERNAL_ERROR sinon
 */
export async function createUserWithUniqueEmail({ email, firstName, lastName, maxIdRetries = 3 }) {
    const normalizedEmail = String(email).trim().toLowerCase();

    for (let attempt = 0; attempt < maxIdRetries; attempt++) {
        const id = nanoid();
        const now = isoNow();

        const emailLockItem = {
            PK: { S: `EMAIL#${normalizedEmail}` },
            SK: { S: "UNIQUE" },
            userId: { S: id },
            createdAt: { S: now },
        };

        const userItem = {
            PK: { S: `USER#${id}` },
            SK: { S: `PROFILE#${id}` },
            GSI1PK: { S: "USER#EMAIL" },
            GSI1SK: { S: normalizedEmail },
            userId: { S: id },
            email: { S: normalizedEmail },
            firstName: firstName ? { S: String(firstName) } : { NULL: true },
            lastName: lastName ? { S: String(lastName) } : { NULL: true },
            createdAt: { S: now },
            updatedAt: { S: now },
        };

        try {
            await ddb.send(new TransactWriteItemsCommand({
                ClientRequestToken: `create-user-${id}-${attempt}`, // idempotence par tentative
                TransactItems: [
                    {
                        Put: {
                            TableName: TABLE,
                            Item: emailLockItem,
                            ConditionExpression: "attribute_not_exists(PK)",
                            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
                        },
                    },
                    {
                        Put: {
                            TableName: TABLE,
                            Item: userItem,
                            ConditionExpression: "attribute_not_exists(PK)",
                            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
                        },
                    },
                ],
            }));

            // Succès : les 2 Put sont passés
            return { userId: id, email: normalizedEmail, createdAt: now };

        } catch (err) {
            const parsed = parseTxCancel(err);

            // On distingue précisément les cas métier
            if (parsed) {
                // A) Email déjà réservé ailleurs
                if (parsed.emailReason === "ConditionalCheckFailed") {
                    const existingOwner = err?.CancellationReasons?.[0]?.Item?.userId?.S ?? null;
                    const e = new Error("EMAIL_ALREADY_EXISTS");
                    e.meta = { email: normalizedEmail, existingOwner };
                    throw e;
                }

                // B) Collision d'ID (rare) → retry
                if (parsed.userReason === "ConditionalCheckFailed") {
                    if (attempt < maxIdRetries - 1) {
                        // petit backoff pour réduire le risque de re-collision dans des charges hautes
                        await new Promise(r => setTimeout(r, 25 * (attempt + 1)));
                        continue;
                    }
                    throw new Error("ID_COLLISION");
                }
            }

            // C) Autres erreurs (IAM, throughput, réseau…)
            const e = new Error("INTERNAL_ERROR");
            e.cause = err;
            throw e;
        }
    }

    // Ne devrait pas arriver
    throw new Error("INTERNAL_ERROR");
}

// ----- Lambda handler HTTP -----
export const handler = async (event) => {
    try {
        const data = JSON.parse(event?.body ?? "{}");
        const email = (data.email || "").trim().toLowerCase();
        const firstName = data.firstName ?? null;
        const lastName = data.lastName ?? null;

        if (!email) {
            return json(400, { ok: false, error: "EMAIL_REQUIRED" });
        }

        const out = await createUserWithUniqueEmail({ email, firstName, lastName });
        return json(201, { ok: true, message: "User created", ...out });

    } catch (err) {
        switch (err?.message) {
            case "EMAIL_ALREADY_EXISTS":
                return json(409, { ok: false, error: "Email déjà utilisé", meta: err.meta ?? null });
            case "ID_COLLISION":
                return json(503, { ok: false, error: "Collision d’identifiant, réessayez." });
            default:
                console.error("AddUser error:", err);
                return json(500, { ok: false, error: "INTERNAL_ERROR" });
        }
    }
};

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    };
}
