import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { json } from "../helpers/toolbox.js";
import { withAuth } from "../middlewares/withAuthMiddlewares.js";

const USER_TABLE = process.env.USER_TABLE;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
});

/**
 * Handler protégé : récupère le profil de l'utilisateur authentifié.
 *
 * Sécurité :
 *   - Requiert un access token JWT valide (via withAuth)
 *   - Retourne UNIQUEMENT les données de l'utilisateur identifié par le JWT
 *   - Un utilisateur ne peut pas consulter le profil d'un autre utilisateur
 *
 * Champs retournés : email, firstName, lastName, updatedAt
 */
export const handler = withAuth(handlerCore, {
    requiredRoles: ["USER"],
});

/**
 * Corps du handler : récupère le profil de l'utilisateur depuis DynamoDB.
 * L'userId est extrait exclusivement du JWT vérifié (jamais de la requête HTTP).
 *
 * @param {Object} event   - Événement Lambda
 * @param {Object} context - Contexte Lambda
 * @param {Object} param2  - Contexte auth injecté par withAuth
 * @param {Object} param2.auth - { userId: string, privilege: string[] }
 */
async function handlerCore(_event, _context, { auth }) {
    try {
        const { userId } = auth;

        // Récupération du profil — l'userId provient du JWT, jamais de l'input utilisateur
        const userProfile = await fetchUserProfileById(userId);

        if (!userProfile) {
            return json(404, { ok: false, message: "USER_NOT_FOUND" });
        }

        return json(200, {
            ok:   true,
            data: userProfile,
        });

    } catch (err) {
        console.error("[getUserLambda] Erreur lors de la récupération du profil :", err.message);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

/**
 * Récupère les données de profil d'un utilisateur depuis DynamoDB.
 * Seuls les champs non-sensibles sont projetés (pas le mot de passe, pas les tokens).
 *
 * @param {string} userId - Identifiant utilisateur brut (sans préfixe "USER#")
 * @returns {Promise<Object|undefined>} Profil utilisateur ou undefined si introuvable
 */
async function fetchUserProfileById(userId) {
    const getCommand = new GetCommand({
        TableName:            USER_TABLE,
        Key: {
            PK: `USER#${userId}`,
            SK: `PROFILE#${userId}`,
        },
        // Projection explicite : on ne retourne jamais de champs sensibles par inadvertance
        ProjectionExpression: "email, firstName, lastName, updatedAt",
        ConsistentRead:       true,
    });

    const result = await ddb.send(getCommand);

    return result.Item;
}
