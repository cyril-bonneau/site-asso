const Database = require('better-sqlite3')
const db = new Database('app.db')

function getUsers(userId) {
    try {
        const data = db.prepare('SELECT email FROM users WHERE user_id= ?');
        const result = data.get(userId);
        return result
    } catch (error) {
        console.error("Error getting users:", error);
    }
}

async function getUserPassword(email) {
    try {
        const data = db.prepare('SELECT password FROM users WHERE email= ?');
        const result = data.get(email);
        return result
    } catch (error) {
        console.error("Error getting user by email:", error);
    }
}
function getUserId(token) {
    try {
        const data = db.prepare('SELECT user_id FROM refresh_tokens WHERE token_hash= ?');
        const result = data.get(token);
        return result
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
    getUserId,
    getUserPassword
}