import { withAuth } from "../middlewares/withAuthMiddlewares"

export const handler = (withAuth(handlerCore));

async function handlerCore(event, _context, { auth }) {
    try {
        console.log('[logoutUser] auth value in handlerCore:', auth);
        console.log('[logoutUser] auth.userId value in handlerCore:', auth ? auth.userId : null);
        console.log('[logoutUser] event.headers["user-agent"] value in handlerCore:', event.headers ? event.headers["user-agent"] : null);
        await logout(auth.userId);
        return json(200, { ok: true, message: "LOGOUT_SUCCESS" });
    } catch (error) {
        console.error("[logoutUser] Erreur fatale dans le handler :", error.message);
        return json(500, { ok: false, message: "INTERNAL_ERROR" });
    }
}

async function logout(userId) {
    // Invalider le refresh token côté serveur
    const result = await invalidateRefreshToken(userId);
    console.log(`[logoutUser] Résultat de l'invalidation du refresh token pour userId ${userId}:`, result);
    return;
}

async function invalidateRefreshToken(userId) {

}