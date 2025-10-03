import Database from 'better-sqlite3';
const db = new Database('app.db');

export function insertToken(data) {
    try {
        const stmt = db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked, created_at, jti) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)');
        const info = stmt.run(data.user_id, data.token_hash, data.expires_at, data.revoked, data.jti);
        console.log(`Refresh token inserted with ID: ${info.lastInsertRowid}`);
        return info
    } catch (error) {
        console.error("Error inserting refresh token:", error);
        return error
    }
}

export async function revokeToken(data) {
    try {
        const stmt = db.prepare('UPDATE refresh_tokens SET revoked = ? WHERE jti = ?');
        const info = stmt.run(data.revoked, data.jti);
        console.log(`Refresh token updated with ID: ${info.changes}`);
        return info
    } catch (error) {
        console.error("Error updating refresh token:", error);
        return error
    }
}

export async function getTokenByJti(jti) {
    try {
        const stmt = db.prepare('SELECT token_hash, revoked FROM refresh_tokens WHERE jti = ?');
        const token = stmt.get(jti);
        return token;
    } catch (error) {
        console.error("Error getting refresh token by hash:", error);
        return
    }
}