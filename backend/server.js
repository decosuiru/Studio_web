const express = require('express');
const http = require('http'); 
const { Server } = require('socket.io'); 
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const pool = require('./database');

const app = express();
const server = http.createServer(app);

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1') || origin.endsWith('.vercel.app') || origin.endsWith('.up.railway.app')) {
            callback(null, true);
        } else {
            callback(null, false); 
        }
    },
    credentials: true
};

app.use(express.json());
app.use(cors(corsOptions));

const io = new Server(server, { cors: corsOptions });
io.on('connection', (socket) => {
    socket.on('disconnect', () => {});
});

const SECRET_KEY = process.env.JWT_SECRET || 'fallback_secret';

const authenticate = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: "Unauthorized access." });
        jwt.verify(token, SECRET_KEY, (err, user) => {
            if (err) return res.status(403).json({ error: "Session expired or invalid." });
            req.user = user;
            next();
        });
    } catch (error) { res.status(500).json({ error: "Auth server error." }); }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'Admin') return res.status(403).json({ error: "Admin access required." });
    next();
};

// --- AUTH & USERS ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET_KEY, { expiresIn: '12h' });
        res.json({ token, user: { name: user.name, role: user.role, email: user.email } });
    } catch (error) { res.status(500).json({ error: "Server error during login." }); }
});

app.get('/api/users', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: "Error fetching accounts." }); }
});

app.post('/api/users', authenticate, isAdmin, async (req, res) => {
    try {
        const { email, password, role } = req.body;
        if (!email || !password || !role) return res.status(400).json({ error: "All fields are required." });
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)', [email.split('@')[0], email, hash, role]);
        res.json({ message: "Account created!" });
    } catch (error) { res.status(500).json({ error: "Error creating account." }); }
});

app.delete('/api/users/:id', authenticate, isAdmin, async (req, res) => {
    try {
        if (req.user.id == req.params.id) return res.status(400).json({ error: "Cannot delete your own account." });
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ message: "Account deleted." });
    } catch (error) { res.status(500).json({ error: "Error deleting account." }); }
});

// --- PETTY CASH (NEW) ---
app.get('/api/petty_cash', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM petty_cash ORDER BY date DESC, created_at DESC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: "Error fetching petty cash." }); }
});

app.post('/api/petty_cash', authenticate, isAdmin, async (req, res) => {
    try {
        const { date, description, type, amount } = req.body;
        if (!date || !description || !type || !amount) return res.status(400).json({ error: "All fields required." });
        await pool.query('INSERT INTO petty_cash (date, description, type, amount) VALUES ($1, $2, $3, $4)',[date, description, type, amount]);
        io.emit('finance_changed');
        res.json({ message: "Transaction added" });
    } catch (error) { res.status(500).json({ error: "Error saving transaction." }); }
});

app.delete('/api/petty_cash/:id', authenticate, isAdmin, async (req, res) => {
    try {
        await pool.query('DELETE FROM petty_cash WHERE id = $1', [req.params.id]);
        io.emit('finance_changed');
        res.json({ message: "Transaction deleted" });
    } catch (error) { res.status(500).json({ error: "Error deleting transaction." }); }
});

// --- BOOKINGS ---
const calculateStatus = (price, dp) => {
    if (dp >= price) return 'Paid';
    if (dp > 0) return 'Partial';
    return 'Unpaid';
};

app.get('/api/bookings', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bookings ORDER BY date ASC, start_time ASC');
        res.json(result.rows);
    } catch (error) { res.status(500).json({ error: "Error fetching bookings." }); }
});

app.post('/api/bookings', authenticate, async (req, res) => {
    try {
        const { client_name, customer_type, client_email, client_phone, date, start_time, end_time, total_price, dp_paid } = req.body;
        if (!client_name || !client_phone || !customer_type) return res.status(400).json({ error: "Name, Phone, and Customer Type required." });

        const t_price = parseFloat(total_price) || 0;
        const d_paid = parseFloat(dp_paid) || 0;
        const remaining = t_price - d_paid;
        
        const overlap = await pool.query(`SELECT id FROM bookings WHERE date = $1 AND ($2 < end_time AND $3 > start_time)`, [date, start_time, end_time]);
        if (overlap.rows.length > 0) return res.status(400).json({ error: "Time slot is already booked." });

        await pool.query(
            `INSERT INTO bookings (client_name, customer_type, client_email, client_phone, date, start_time, end_time, total_price, dp_paid, remaining_payment, status) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,[client_name, customer_type, client_email, client_phone, date, start_time, end_time, t_price, d_paid, remaining, calculateStatus(t_price, d_paid)]
        );
        io.emit('bookings_changed');
        res.json({ message: "Booking created" });
    } catch (error) { res.status(500).json({ error: "Error creating booking." }); }
});

app.put('/api/bookings/:id', authenticate, async (req, res) => {
    try {
        const { client_name, customer_type, client_email, client_phone, date, start_time, end_time, total_price, dp_paid } = req.body;
        const { id } = req.params;
        if (!client_name || !client_phone || !customer_type) return res.status(400).json({ error: "Required fields missing." });

        const t_price = parseFloat(total_price) || 0;
        const d_paid = parseFloat(dp_paid) || 0;
        const remaining = t_price - d_paid;

        const overlap = await pool.query(`SELECT id FROM bookings WHERE date = $1 AND id != $2 AND ($3 < end_time AND $4 > start_time)`, [date, id, start_time, end_time]);
        if (overlap.rows.length > 0) return res.status(400).json({ error: "Time slot is already booked." });

        await pool.query(
            `UPDATE bookings SET client_name=$1, customer_type=$2, client_email=$3, client_phone=$4, date=$5, start_time=$6, end_time=$7, total_price=$8, dp_paid=$9, remaining_payment=$10, status=$11 WHERE id=$12`,[client_name, customer_type, client_email, client_phone, date, start_time, end_time, t_price, d_paid, remaining, calculateStatus(t_price, d_paid), id]
        );
        io.emit('bookings_changed');
        res.json({ message: "Booking updated" });
    } catch (error) { res.status(500).json({ error: "Error updating booking." }); }
});

app.delete('/api/bookings/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM bookings WHERE id = $1',[req.params.id]);
        io.emit('bookings_changed');
        res.json({ message: "Booking deleted" });
    } catch (error) { res.status(500).json({ error: "Error deleting booking." }); }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 API + WebSockets running on port ${PORT}`));
