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
        } else { callback(null, false); }
    },
    credentials: true
};

app.use(express.json());
app.use(cors(corsOptions));

const io = new Server(server, { cors: corsOptions });
io.on('connection', (socket) => { socket.on('disconnect', () => {}); });

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
        if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
        const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET_KEY, { expiresIn: '12h' });
        res.json({ token, user: { name: user.name, role: user.role, email: user.email } });
    } catch (error) { res.status(500).json({ error: "Server error during login." }); }
});

app.get('/api/users', authenticate, isAdmin, async (req, res) => {
    try { res.json((await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC')).rows); } 
    catch (error) { res.status(500).json({ error: "Error fetching accounts." }); }
});

app.post('/api/users', authenticate, isAdmin, async (req, res) => {
    try {
        const { email, password, role } = req.body;
        if (!email || !password || !role) return res.status(400).json({ error: "All fields are required." });
        const hash = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',[email.split('@')[0], email, hash, role]);
        res.json({ message: "Account created!" });
    } catch (error) { res.status(500).json({ error: "Error creating account." }); }
});

app.delete('/api/users/:id', authenticate, isAdmin, async (req, res) => {
    try {
        if (req.user.id == req.params.id) return res.status(400).json({ error: "Cannot delete your own account." });
        await pool.query('DELETE FROM users WHERE id = $1',[req.params.id]);
        res.json({ message: "Account deleted." });
    } catch (error) { res.status(500).json({ error: "Error deleting account." }); }
});

// --- PETTY CASH ---
app.get('/api/petty_cash', authenticate, async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM petty_cash ORDER BY date DESC, created_at DESC')).rows); } 
    catch (error) { res.status(500).json({ error: "Error fetching petty cash." }); }
});

app.post('/api/petty_cash', authenticate, async (req, res) => {
    try {
        const { date, description, type, amount } = req.body;
        await pool.query('INSERT INTO petty_cash (date, description, type, amount) VALUES ($1, $2, $3, $4)',[date, description, type, amount]);
        io.emit('finance_changed');
        res.json({ message: "Transaction added" });
    } catch (error) { res.status(500).json({ error: "Error saving transaction." }); }
});

app.put('/api/petty_cash/:id', authenticate, async (req, res) => {
    try {
        const { date, description, type, amount } = req.body;
        await pool.query('UPDATE petty_cash SET date=$1, description=$2, type=$3, amount=$4 WHERE id=$5',[date, description, type, amount, req.params.id]);
        io.emit('finance_changed');
        res.json({ message: "Transaction updated" });
    } catch (error) { res.status(500).json({ error: "Error updating transaction." }); }
});

app.delete('/api/petty_cash/:id', authenticate, async (req, res) => {
    try {
        await pool.query('DELETE FROM petty_cash WHERE id = $1', [req.params.id]);
        io.emit('finance_changed');
        res.json({ message: "Transaction deleted" });
    } catch (error) { res.status(500).json({ error: "Error deleting transaction." }); }
});

app.post('/api/petty_cash/reset', authenticate, isAdmin, async (req, res) => {
    try {
        const result = await pool.query('SELECT type, amount FROM petty_cash');
        let balance = 0;
        result.rows.forEach(r => { if (r.type === 'IN') balance += parseFloat(r.amount); else balance -= parseFloat(r.amount); });
        
        if (balance > 0) {
            await pool.query('INSERT INTO petty_cash (date, description, type, amount) VALUES (CURRENT_DATE, $1, $2, $3)',['Admin Withdrawal to Zero', 'OUT', balance]);
            io.emit('finance_changed');
            res.json({ message: "Balance withdrawn to 0 successfully." });
        } else {
            res.status(400).json({ error: "No balance to withdraw." });
        }
    } catch (error) { res.status(500).json({ error: "Error resetting balance." }); }
});

// --- BOOKINGS ---
const calculateStatus = (price, totalReceived) => {
    if (totalReceived >= price) return 'Paid';
    if (totalReceived > 0) return 'Partial';
    return 'Unpaid';
};

app.get('/api/bookings', authenticate, async (req, res) => {
    try { res.json((await pool.query('SELECT * FROM bookings ORDER BY date ASC, start_time ASC')).rows); } 
    catch (error) { res.status(500).json({ error: "Error fetching bookings." }); }
});

app.post('/api/bookings', authenticate, async (req, res) => {
    try {
        let { client_name, customer_type, client_email, client_phone, date, start_time, end_time, total_price, dp_paid, settlement_paid } = req.body;
        if (!client_name || !client_phone || !customer_type) return res.status(400).json({ error: "Missing required fields." });

        let t_price = parseFloat(total_price) || 0;
        let d_paid = parseFloat(dp_paid) || 0;
        let s_paid = parseFloat(settlement_paid) || 0;

        if (customer_type === 'Management') { t_price = 0; d_paid = 0; s_paid = 0; }

        const total_received = d_paid + s_paid;
        const remaining = t_price - total_received;
        const status = customer_type === 'Management' ? 'Paid' : calculateStatus(t_price, total_received);
        
        const dp_timestamp = d_paid > 0 ? new Date() : null;
        const full_timestamp = (s_paid > 0 || (t_price > 0 && total_received >= t_price)) || customer_type === 'Management' ? new Date() : null;

        const overlap = await pool.query(`SELECT id FROM bookings WHERE date = $1 AND ($2 < end_time AND $3 > start_time)`,[date, start_time, end_time]);
        if (overlap.rows.length > 0) return res.status(400).json({ error: "Time slot is booked." });

        await pool.query(
            `INSERT INTO bookings (client_name, customer_type, client_email, client_phone, date, start_time, end_time, total_price, dp_paid, settlement_paid, remaining_payment, status, dp_timestamp, full_timestamp) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,[client_name, customer_type, client_email, client_phone, date, start_time, end_time, t_price, d_paid, s_paid, remaining, status, dp_timestamp, full_timestamp]
        );
        io.emit('bookings_changed');
        res.json({ message: "Booking created" });
    } catch (error) { res.status(500).json({ error: "Error creating booking." }); }
});

app.put('/api/bookings/:id', authenticate, async (req, res) => {
    try {
        let { client_name, customer_type, client_email, client_phone, date, start_time, end_time, total_price, dp_paid, settlement_paid } = req.body;
        const { id } = req.params;

        let t_price = parseFloat(total_price) || 0;
        let d_paid = parseFloat(dp_paid) || 0;
        let s_paid = parseFloat(settlement_paid) || 0;

        if (customer_type === 'Management') { t_price = 0; d_paid = 0; s_paid = 0; }

        const total_received = d_paid + s_paid;
        const remaining = t_price - total_received;
        const status = customer_type === 'Management' ? 'Paid' : calculateStatus(t_price, total_received);

        const existing = await pool.query('SELECT dp_timestamp, full_timestamp FROM bookings WHERE id = $1', [id]);
        let dp_ts = existing.rows[0].dp_timestamp;
        let full_ts = existing.rows[0].full_timestamp;

        if (d_paid > 0 && !dp_ts) dp_ts = new Date();
        if (s_paid > 0 && !full_ts) full_ts = new Date();
        if (customer_type === 'Management' && !full_ts) full_ts = new Date();

        const overlap = await pool.query(`SELECT id FROM bookings WHERE date = $1 AND id != $2 AND ($3 < end_time AND $4 > start_time)`,[date, id, start_time, end_time]);
        if (overlap.rows.length > 0) return res.status(400).json({ error: "Time slot is booked." });

        await pool.query(
            `UPDATE bookings SET client_name=$1, customer_type=$2, client_email=$3, client_phone=$4, date=$5, start_time=$6, end_time=$7, total_price=$8, dp_paid=$9, settlement_paid=$10, remaining_payment=$11, status=$12, dp_timestamp=$13, full_timestamp=$14 WHERE id=$15`,[client_name, customer_type, client_email, client_phone, date, start_time, end_time, t_price, d_paid, s_paid, remaining, status, dp_ts, full_ts, id]
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
