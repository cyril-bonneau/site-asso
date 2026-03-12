/**
 * validateCsrf.js
 *
 * Utilitaire de protection CSRF pour les routes Lambda qui utilisent
 * des cookies httpOnly avec SameSite=None (cross-origin obligatoire).
 *
 * Pourquoi cette protection est nécessaire :
 *   Le cookie refreshToken est configuré SameSite=None pour permettre les appels
 *   cross-origin depuis le frontend CloudFront vers l'API Gateway.
 *   SameSite=None signifie que le navigateur envoie ce cookie sur TOUTES les
 *   requêtes vers l'API, y compris depuis un site malveillant → risque CSRF.
 *
 * Double vérification appliquée :
 *   1. Header `Origin` : doit être présent et appartenir à la liste blanche.
 *      Un site malveillant ne peut pas forger un Origin légitime (bloqué par le navigateur).
 *
 *   2. Header `X-Requested-With: XMLHttpRequest` : doit être présent.
 *      Ce header ne peut pas être envoyé depuis un formulaire HTML classique
 *      ou une balise <img> / <script>, ce qui couvre les vecteurs CSRF simples.
 *
 * Configuration :
 *   Variable d'environnement ALLOWED_ORIGINS (obligatoire en production) :
 *   Valeur : liste de domaines séparés par des virgules.
 *   Exemple : "https://abc123.cloudfront.net,https://monsite.fr"
 */

// Liste des origines autorisées, lue depuis la variable d'environnement.
// Les espaces autour des virgules sont ignorés.
const ALLOWED_ORIGINS_RAW = process.env.ALLOWED_ORIGINS || "";

const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

/**
 * Vérifie les headers CSRF d'une requête Lambda entrante.
 *
 * Doit être appelée en tout premier dans les handlers qui utilisent le cookie
 * de refresh token (routes sans Authorization Bearer).
 *
 * @param {Object} event - Événement Lambda (format API Gateway HTTP API v2)
 * @returns {{ ok: boolean, reason?: string }}
 *   - ok: true si la requête est légitime
 *   - reason: code d'erreur si ok === false (pour logging interne, ne pas exposer au client)
 */
export function validateCsrfHeaders(event) {

    // Configuration manquante : fail closed pour forcer la configuration explicite
    if (ALLOWED_ORIGINS.length === 0) {
        console.error("[validateCsrf] ALLOWED_ORIGINS n'est pas configuré. Requête rejetée par sécurité.");
        return {
            ok:     false,
            reason: "CSRF_CONFIG_MISSING",
        };
    }

    // Normaliser les headers (API Gateway peut les transmettre en minuscules)
    const headers          = event?.headers || {};
    const originHeader     = headers["origin"]           || headers["Origin"]           || "";
    const xRequestedWith   = headers["x-requested-with"] || headers["X-Requested-With"] || "";

    // --- Vérification 1 : présence et validité de l'Origin ---
    // L'absence d'Origin sur une requête cross-origin est suspecte (navigateur ou bot atypique).
    if (!originHeader) {
        console.warn("[validateCsrf] Header Origin absent.");
        return {
            ok:     false,
            reason: "MISSING_ORIGIN_HEADER",
        };
    }

    if (!ALLOWED_ORIGINS.includes(originHeader)) {
        console.warn("[validateCsrf] Origin non autorisé :", originHeader);
        return {
            ok:     false,
            reason: "ORIGIN_NOT_ALLOWED",
        };
    }

    // --- Vérification 2 : présence du header X-Requested-With ---
    // Un formulaire HTML natif ou une requête CSRF classique ne peut pas envoyer ce header.
    // Le frontend doit explicitement le poser sur chaque appel fetch/axios.
    if (xRequestedWith !== "XMLHttpRequest") {
        console.warn("[validateCsrf] Header X-Requested-With absent ou invalide :", xRequestedWith);
        return {
            ok:     false,
            reason: "MISSING_X_REQUESTED_WITH",
        };
    }

    return { ok: true };
}
