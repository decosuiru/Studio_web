const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'booking.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`PRAGMA foreign_keys = ON;`);

    // [UPDATED] Users Table with created_at
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, email TEXT UNIQUE, password TEXT, role TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // [NEW] Auto-migrate existing users table to add created_at if it's missing
    db.run(`ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`, (err) => {
        // Silently ignore if the column already exists
    });

    // Bookings Table
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name TEXT NOT NULL,
        client_email TEXT,
        client_phone TEXT NOT NULL,
        date TEXT, start_time TEXT, end_time TEXT, studio TEXT,
        total_price REAL, dp_paid REAL, remaining_payment REAL, status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed Admin (Updated role to 'Admin')
    const adminPass = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (id, name, email, password, role) VALUES (1, 'Super Admin', 'admin@studio.com', '${adminPass}', 'Admin')`);
});

module.exports = db;