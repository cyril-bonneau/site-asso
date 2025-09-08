const Database = require('better-sqlite3')
const db = new Database('app.db')

async function insertUser(data) {
    try {
        const stmt = db.prepare('INSERT INTO users (email, name, phone, password) VALUES (?, ?, ?, ?)');
        const info = stmt.run(data.email, data.name, data.phone, data.password);
        console.log(`User inserted with ID: ${info.lastInsertRowid}`);
    } catch (error) {
        console.error("Error inserting user:", error);
        return error
    }
}

function insertKilometers(data) {
    try {
        const stmt = db.prepare('INSERT INTO vehicle_mileage (user_id, odometer_start, odometer_end, distance_to_service) VALUES (?, ?, ?, ?)');
        const info = stmt.run(data.user_id, data.odometer_start, data.odometer_end, data.distance_to_service);
        console.log(`Kilometers inserted with ID: ${info.lastInsertRowid}`);
    } catch (error) {
        console.error("Error inserting kilometers:", error);
        return error
    }
}

function insertRefreshToken(data) {
    try {
        const stmt = db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');
        const info = stmt.run(data.user_id, data.token_hash, data.expires_at, data.revoked);
        console.log(`Refresh token inserted with ID: ${info.lastInsertRowid}`);
    } catch (error) {
        console.error("Error inserting refresh token:", error);
        return error
    }
}

module.exports = {
    insertUser,
    insertKilometers,
    insertRefreshToken
}