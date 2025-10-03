import Database from 'better-sqlite3';
const db = new Database('app.db');

export function getUsers(userId) {
    try {
        const data = db.prepare('SELECT email FROM users WHERE user_id= ?');
        const result = data.get(userId);
        return result
    } catch (error) {
        console.error("Error getting users:", error);
    }
}

export async function getUserPasswordAndId(email) {
    try {
        const data = db.prepare('SELECT id, password FROM users WHERE email= ?');
        const result = data.get(email);
        return result
    } catch (error) {
        console.error("Error getting user by email:", error);
    }
}

export function getUserId(token) {
    try {
        const data = db.prepare('SELECT user_id FROM refresh_tokens WHERE token_hash= ?');
        const result = data.get(token);
        return result
    } catch (error) {
        console.error("Error getting user ID:", error);
    }
}

// function getKilometers(id) {
//     try {
//         db.prepare(`SELECT odometer_end FROM vehicle_mileage WHERE user_id=${id}`).run();
//     } catch (error) {
//         console.error("Error getting kilometers:", error);
//     }
// }