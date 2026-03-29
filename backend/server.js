const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require('./database');

const app = express();
app.use(express.json());

// SAFE CORS CONFIGURATION (Prevents Vercel/Localhost crashes)
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.endsWith('.vercel.app')) {
            callback(null, true);
        } else {
            callback(null, false); 
        }
    },
    credentials: true
}));

const SECRET_KEY = process.env.JWT_SECRET || 'fallback_secret';

// --- AUTH MIDDLEWARE ---
const authenticate = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: "Unauthorized access." });
        
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) return res.status(403).json({ error: "Session expired or invalid." });
            req.user = user;
            next();
        });
    } catch (error) {
        console.error("Auth Error:", error);
        res.status(500).json({ error: "Authentication server error." });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'Admin') return res.status(403).json({ error: "Admin access required." });
    next();
};

// --- LOGIN ROUTE ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) return res.status(401).json({ error: "Invalid credentials" });
        
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

        const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET_KEY, { expiresIn: '12h' });
        res.json({ token, user: { name: user.name, role: user.role, email: user.email } });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ error: "Internal server error during login." });
    }
});

// --- USERS API (ADMIN ONLY) ---
app.get('/api/users', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        console.error("Get Users Error:", error);
        res.status(500).json({ error: "Error fetching accounts." });
    }
});

app.post('/api/users', authenticate, isAdmin, async (req, res) => {
    try {
        const { email, password, role } = req.body;
        if (!email || !password || !role) return res.status(400).json({ error: "All fields are required." });

        const hash = await bcrypt.hash(password, 10);
        const name = email.split('@')[0]; 

        await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
            [name, email, hash, role]
        );
        res.json({ message: "Account created successfully!" });
    } catch (error) {
        console.error("Create User Error:", error);
        if (error.code === '23505') return res.status(400).json({ error: "Email already exists." });
        res.status(500).json({ error: "Error creating account." });
    }
});

app.delete('/api/users/:id', authenticate, isAdmin, async (req, res) => {
    try {
        if (req.user.id == req.params.id) return res.status(400).json({ error: "Cannot delete your own account." });
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ message: "Account deleted." });
    } catch (error) {
        console.error("Delete User Error:", error);
        res.status(500).json({ error: "Error deleting account." });
    }
});

// --- BOOKINGS API ---
const calculateStatus = (price, dp) => {
    if (dp >= price) return 'Paid';
    if (dp > 0) return 'Partial';
    return 'Unpaid';
};

app.get('/api/bookings', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bookings ORDER BY date ASC, start_time ASC');
        res.json(result.rows);
    } catch (error) {
        console.error("Get Bookings Error:", error);
        res.status(500).json({ error: "Error fetching bookings." });
    }
});

app.post('/api/bookings', authenticate, async (req, res) => {
    try {
        const { client_name, client_email, client_phone, date, start_time, end_time, studio, total_price, dp_paid } = req.body;
        if (!client_name || !client_phone) return res.status(400).json({ error: "Client Name and Phone are required." });

        const t_price = parseFloat(total_price) || 0;
        const d_paid = parseFloat(dp_paid) || 0;
        const remaining = t_price - d_paid;
        const status = calculateStatus(t_price, d_paid);
        
        const overlap = await pool.query(
            `SELECT id FROM bookings WHERE studio = $1 AND date = $2 AND ($3 < end_time AND $4 > start_time)`,[studio, date, start_time, end_time]
        );
        if (overlap.rows.length > 0) return res.status(400).json({ error: "Studio is already booked for this time." });

        const insertQuery = `
            INSERT INTO bookings (client_name, client_email, client_phone, date, start_time, end_time, studio, total_price, dp_paid, remaining_payment, status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
        `;
        const newBooking = await pool.query(insertQuery,[client_name, client_email, client_phone, date, start_time, end_time, studio, t_price, d_paid, remaining, status]);
        res.json({ message: "Booking created", id: newBooking.rows[0].id });
    } catch (error) {
        console.error("Create Booking Error:", error);
        res.status(500).json({ error: "Error creating booking." });
    }
});

app.put('/api/bookings/:id', authenticate, async (req, res) => {
    try {
        const { client_name, client_email, client_phone, date, start_time, end_time, studio, total_price, dp_paid } = req.body;
        const { id } = req.params;

        if (!client_name || !client_phone) return res.status(400).json({ error: "Client Name and Phone are required." });

        const t_price = parseFloat(total_price) || 0;
        const d_paid = parseFloat(dp_paid) || 0;
        const remaining = t_price - d_paid;
        const status = calculateStatus(t_price, d_paid);

        const overlap = await pool.query(
            `SELECT id FROM bookings WHERE studio = $1 AND date = $2 AND id != $3 AND ($4 < end_time AND $5 > start_time)`,
            [studio, date, id, start_time, end_time]
        );
        if (overlap.rows.length > 0) return res.status(400).json({ error: "Studio is already booked for this time." });

        const updateQuery = `
            UPDATE bookings SET 
                client_name=$1, client_email=$2, client_phone=$3, date=$4, start_time=$5, end_time=$6, studio=$7, 
                total_price=$8, dp_paid=$9, remaining_payment=$10, status=$11 
            WHERE id=$12
        `;
        await pool.query(updateQuery,[client_name, client_email, client_phone, date, start_time, end_time, studio, t_price, d_paid, remaining, status, id]);
        res.json({ message: "Booking updated" });
    } catch (error) {
        console.error("Update Booking Error:", error);
        res.status(500).json({ error: "Error updating booking." });
    }
});

app.delete('/api/bookings/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM bookings WHERE id = $1', [req.params.id]);
        res.json({ message: "Booking deleted" });
    } catch (error) {
        console.error("Delete Booking Error:", error);
        res.status(500).json({ error: "Error deleting booking." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 API running on port ${PORT}`));
