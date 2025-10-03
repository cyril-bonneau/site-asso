import Database from 'better-sqlite3';
const db = new Database('app.db');

export async function insertUser(data) {
    try {
        const stmt = db.prepare('INSERT INTO users (email, name, phone, password) VALUES (?, ?, ?, ?)');
        stmt.run(data.email, data.name, data.phone, data.password);
        return { code: 201 }
    } catch (error) {
        console.error("Error inserting user:", error);
        return error
    }
}

// function insertKilometers(data) {
//     try {
//         const stmt = db.prepare('INSERT INTO vehicle_mileage (user_id, odometer_start, odometer_end, distance_to_service) VALUES (?, ?, ?, ?)');
//         const info = stmt.run(data.user_id, data.odometer_start, data.odometer_end, data.distance_to_service);
//         console.log(`Kilometers inserted with ID: ${info.lastInsertRowid}`);
//     } catch (error) {
//         console.error("Error inserting kilometers:", error);
//         return error
//     }
// }
