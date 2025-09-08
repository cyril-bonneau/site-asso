const Database = require('better-sqlite3')
const db = new Database('users.db')

function getUsers(userId) {
    try {
        db.prepare(`SELECT email FROM users WHERE user_id=${userId}`).run();
    } catch (error) {
        console.error("Error getting users:", error);
    }
}

function getUserPassword(email) {
    try {
        db.prepare(`SELECT password FROM users WHERE email='${email}'`).run();
    } catch (error) {
        console.error("Error getting user by email:", error);
    }
}
function getUserId(token) {
    try {
        db.prepare(`SELECT user_id FROM refresh_tokens WHERE token_hash=${token}`).run();
    } catch (error) {
        console.error("Error getting user ID:", error);
    }
}

function getKilometers(id) {
    try {
        db.prepare(`SELECT odometer_end FROM vehicle_mileage WHERE user_id=${id}`).run();
    } catch (error) {
        console.error("Error getting kilometers:", error);
    }
}

module.exports = {
    getUsers,
    getKilometers,
    getUserId
}