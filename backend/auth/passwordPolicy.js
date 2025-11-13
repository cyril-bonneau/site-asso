// backend/auth/passwordPolicy.js
import crypto from "node:crypto";
import https from "node:https";

/** petit set local de mots de passe trop communs (échantillon) */
const LOCAL_BLACKLIST = new Set([
    "123456", "password", "123456789", "qwerty", "abc123", "azerty", "admin",
    "iloveyou", "welcome", "monkey", "dragon", "football", "letmein", "000000"
]);

const SEQUENCES = [
    "abcdefghijklmnopqrstuvwxyz",
    "qwertyuiopasdfghjklzxcvbnm",
    "0123456789"
];

function containsSequence(strLower) {
    for (const seq of SEQUENCES) {
        for (let i = 0; i <= seq.length - 4; i++) {
            const s = seq.slice(i, i + 4);
            if (strLower.includes(s) || strLower.includes([...s].reverse().join(""))) {
                return true;
            }
        }
    }
    return false;
}

function hasRepetition(str) {
    return /(.)\1{3,}/.test(str); // ≥4 caractères identiques d'affilée
}

/** HIBP k-anonymity: retourne true si trouvé dans une fuite connue */
async function isPwnedByHIBP(password, timeoutMs = 1500) {
    const sha1 = crypto.createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const options = {
        hostname: "api.pwnedpasswords.com",
        path: `/range/${prefix}`,
        method: "GET",
        headers: { "User-Agent": "site-asso-register/1.0" },
        timeout: timeoutMs
    };

    const body = await new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve(data));
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(new Error("timeout")); });
        req.end();
    }).catch(() => null);

    if (!body) return false; // fail-soft : on ne bloque pas si HIBP indispo

    // Format: "<SUFFIX>:<count>\r\n"
    return body.split("\n").some(line => line.startsWith(suffix));
}

/**
 * Valide un mot de passe côté backend
 * @param {string} password
 * @param {{ email?: string, username?: string, useHIBP?: boolean }} ctx
 * @returns {Promise<{ ok: boolean, reasons?: string[] }>}
 */
export async function validatePasswordBackend(password, ctx = {}) {
    const reasons = [];
    const minLen = 12, maxLen = 128;

    // 1) Longueur
    if (typeof password !== "string" || password.length < minLen) {
        reasons.push(`Le mot de passe doit contenir au moins ${minLen} caractères.`);
    }
    if (password && password.length > maxLen) {
        reasons.push(`Le mot de passe doit contenir au plus ${maxLen} caractères.`);
    }
    if (reasons.length) return { ok: false, reasons };

    const pwLower = password.toLowerCase();

    // 2) Pas d'info personnelle
    if (ctx.email && pwLower.includes(String(ctx.email).toLowerCase())) {
        reasons.push("Le mot de passe ne doit pas contenir votre e-mail.");
    }
    if (ctx.username) {
        const u = String(ctx.username).toLowerCase();
        if (u.length >= 3 && pwLower.includes(u)) {
            reasons.push("Le mot de passe ne doit pas contenir votre identifiant.");
        }
    }

    // 3) Mot de passe trop commun
    if (LOCAL_BLACKLIST.has(pwLower)) {
        reasons.push("Mot de passe trop commun. Choisissez-en un autre.");
    }

    // 4) Suites triviales / répétitions
    if (containsSequence(pwLower)) {
        reasons.push("Évitez les suites évidentes (ex. 1234, abcd, qwerty).");
    }
    if (hasRepetition(password)) {
        reasons.push("Évitez les répétitions de caractères (ex. aaaa, 1111).");
    }

    // 5) (Optionnel) Vérification HIBP
    if (ctx.useHIBP) {
        const pwned = await isPwnedByHIBP(password).catch(() => false);
        if (pwned) reasons.push("Ce mot de passe est présent dans des fuites connues (HIBP).");
    }

    return reasons.length ? { ok: false, reasons } : { ok: true };
}
