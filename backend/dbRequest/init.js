const Database = require('better-sqlite3')
const db = new Database('app.db')

//creation of table
function initUserDB() {
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    phone TEXT, 
    password TEXT)`).run();
    } catch (error) {
        console.error("Error creating table:", error);
        return error
    }
}

function initAuthManagementDB() {
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`).run();
    } catch (error) {
        console.error("Error creating table:", error);
        return error
    }
}

function initUserDataDB() {
    try {
        db.prepare(`CREATE TABLE IF NOT EXISTS vehicle_mileage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            odometer_start TEXT,
            odometer_end TEXT,
            distance_to_service TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id))`).run();
    } catch (error) {
        console.error("Error creating table:", error);
        return error
    }
}

module.exports = {
    initUserDB,
    initAuthManagementDB,
    initUserDataDB,
} 