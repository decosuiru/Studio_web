// ⚠️ CHANGE THIS URL WHEN DEPLOYING TO RAILWAY
const API_URL = 'https://studioweb-production.up.railway.app'; 
// Example: 'https://my-backend.up.railway.app/api'

let currentUser, currentToken;
let fullCalendarInstance = null;
let allBookings =[];

const formatIDR = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num || 0);

function showAlert(msg, isError = false) {
    const alertBox = document.getElementById('alert-box');
    alertBox.textContent = msg;
    alertBox.className = `alert ${isError ? 'error' : ''}`;
    alertBox.classList.remove('hidden');
    setTimeout(() => alertBox.classList.add('hidden'), 3000);
}

function getHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` };
}

async function safeFetch(url, options = {}) {
    try {
        const res = await fetch(url, options);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("API returned non-JSON response. Check your API URL.");
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Server error");
        return data;
    } catch (err) {
        console.error("Fetch Error:", err);
        throw err;
    }
}

// --- AUTH ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const data = await safeFetch(`${API_URL}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
        });
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        initApp();
    } catch (err) { showAlert(err.message, true); }
});

function logout() { localStorage.clear(); window.location.reload(); }

function initApp() {
    currentToken = localStorage.getItem('token');
    if (!currentToken) return;

    currentUser = JSON.parse(localStorage.getItem('user'));
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    document.getElementById('user-info').textContent = `${currentUser.name} (${currentUser.role})`;

    if (currentUser.role !== 'Admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    }
    showSection('calendar');
}

// --- NAVIGATION & FETCH ---
async function showSection(section) {
    document.querySelectorAll('.section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${section}-section`).classList.remove('hidden');
    document.getElementById('section-title').textContent = section.charAt(0).toUpperCase() + section.slice(1);

    try {
        allBookings = await safeFetch(`${API_URL}/bookings`, { headers: getHeaders() });
    } catch (err) { showAlert("Error fetching bookings", true); }

    if (section === 'calendar') renderCalendar();
    if (section === 'bookings') renderListTable();
    if (section === 'finance' && currentUser.role === 'Admin') renderFinanceTable();
    if (section === 'accounts' && currentUser.role === 'Admin') renderAccountsTable();
}

// --- RENDERING ---
function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    const events = allBookings.map(b => ({
        id: b.id, title: `${b.client_name} - ${b.studio}`,
        start: `${b.date.split('T')[0]}T${b.start_time}`, end: `${b.date.split('T')[0]}T${b.end_time}`,
        backgroundColor: b.status === 'Paid' ? '#22c55e' : (b.status === 'Partial' ? '#f97316' : '#ef4444'),
        extendedProps: b
    }));

    if (fullCalendarInstance) fullCalendarInstance.destroy();
    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth', height: '100%', stickyHeaderDates: true,
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
        editable: true, events: events,
        eventClick: (info) => openDetailModal(info.event.extendedProps),
        eventDrop: async (info) => {
            const b = info.event.extendedProps;
            const newDate = info.event.startStr.split('T')[0];
            const newStart = info.event.startStr.split('T')[1].substring(0,5);
            const newEnd = info.event.endStr ? info.event.endStr.split('T')[1].substring(0,5) : b.end_time;
            try {
                await safeFetch(`${API_URL}/bookings/${b.id}`, {
                    method: 'PUT', headers: getHeaders(),
                    body: JSON.stringify({ ...b, date: newDate, start_time: newStart, end_time: newEnd })
                });
                showAlert("Moved Successfully");
                allBookings = await safeFetch(`${API_URL}/bookings`, { headers: getHeaders() });
            } catch (err) { info.revert(); showAlert(err.message, true); }
        }
    });
    fullCalendarInstance.render();
}

function renderListTable() {
    document.querySelector('#bookings-table tbody').innerHTML = allBookings.map(b => `
        <tr>
            <td>${b.date.split('T')[0]}</td>
            <td>${b.start_time.substring(0,5)}</td>
            <td><strong>${b.client_name}</strong></td>
            <td>${b.studio}</td>
            <td><span class="status-pill status-${b.status}">${b.status}</span></td>
            <td><button class="primary-btn" style="padding: 5px" onclick="openDetailModalById(${b.id})">Detail</button></td>
        </tr>
    `).join('');
}

function renderFinanceTable() {
    let gross = 0, dp = 0, remain = 0;
    allBookings.forEach(b => { gross += parseFloat(b.total_price); dp += parseFloat(b.dp_paid); remain += parseFloat(b.remaining_payment); });
    document.getElementById('fin-income').textContent = formatIDR(gross);
    document.getElementById('fin-dp').textContent = formatIDR(dp);
    document.getElementById('fin-remain').textContent = formatIDR(remain);
}

// --- MODALS ---
function openDetailModalById(id) {
    const b = allBookings.find(x => x.id === id);
    if(b) openDetailModal(b);
}

function openDetailModal(b) {
    document.getElementById('det_name').textContent = b.client_name;
    document.getElementById('det_phone').textContent = b.client_phone;
    document.getElementById('det_email').textContent = b.client_email || "N/A";
    document.getElementById('det_date').textContent = b.date.split('T')[0];
    document.getElementById('det_time').textContent = `${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}`;
    document.getElementById('det_studio').textContent = b.studio;
    document.getElementById('det_total').textContent = formatIDR(b.total_price);
    document.getElementById('det_dp').textContent = formatIDR(b.dp_paid);
    document.getElementById('det_remain').textContent = formatIDR(b.remaining_payment);
    
    document.getElementById('det_status').textContent = b.status;
    document.getElementById('det_status').className = `status-pill status-${b.status}`;

    document.getElementById('btn-edit-from-detail').onclick = () => openEditModal(b);
    document.getElementById('delete-btn').onclick = () => deleteFromModal(b.id);
    document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() { document.getElementById('detail-modal').classList.add('hidden'); }

function calcRemaining() {
    const p = parseFloat(document.getElementById('total_price').value) || 0;
    const dp = parseFloat(document.getElementById('dp_paid').value) || 0;
    document.getElementById('remaining-text').textContent = formatIDR(p - dp);
}

function openBookingModal() {
    document.getElementById('booking-form').reset();
    document.getElementById('booking_id').value = "";
    document.getElementById('modal-title').textContent = "New Booking";
    calcRemaining();
    document.getElementById('booking-modal').classList.remove('hidden');
}

function openEditModal(b) {
    closeDetailModal(); 
    document.getElementById('booking_id').value = b.id;
    document.getElementById('modal-title').textContent = "Edit Booking";
    document.getElementById('client_name').value = b.client_name;
    document.getElementById('client_phone').value = b.client_phone;
    document.getElementById('client_email').value = b.client_email || "";
    document.getElementById('date').value = b.date.split('T')[0];
    document.getElementById('start_time').value = b.start_time.substring(0,5);
    document.getElementById('end_time').value = b.end_time.substring(0,5);
    document.getElementById('studio').value = b.studio;
    document.getElementById('total_price').value = b.total_price;
    document.getElementById('dp_paid').value = b.dp_paid;
    calcRemaining();
    document.getElementById('booking-modal').classList.remove('hidden');
}

function closeBookingModal() { document.getElementById('booking-modal').classList.add('hidden'); }

// --- FORMS & CRUD ---
document.getElementById('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
        client_name: document.getElementById('client_name').value.trim(),
        client_phone: document.getElementById('client_phone').value.trim(),
        client_email: document.getElementById('client_email').value.trim(),
        date: document.getElementById('date').value,
        start_time: document.getElementById('start_time').value,
        end_time: document.getElementById('end_time').value,
        studio: document.getElementById('studio').value,
        total_price: parseFloat(document.getElementById('total_price').value) || 0,
        dp_paid: parseFloat(document.getElementById('dp_paid').value) || 0
    };

    const bookingId = document.getElementById('booking_id').value;
    const url = bookingId ? `${API_URL}/bookings/${bookingId}` : `${API_URL}/bookings`;

    try {
        await safeFetch(url, { method: bookingId ? 'PUT' : 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
        showAlert(bookingId ? "Updated!" : "Saved!");
        closeBookingModal();
        showSection(document.querySelector('.section:not(.hidden)').id.replace('-section', ''));
    } catch (err) { showAlert(err.message, true); }
});

async function deleteFromModal(id) {
    if (!confirm("Delete this booking?")) return;
    try {
        await safeFetch(`${API_URL}/bookings/${id}`, { method: 'DELETE', headers: getHeaders() });
        showAlert("Deleted!");
        closeDetailModal();
        showSection(document.querySelector('.section:not(.hidden)').id.replace('-section', ''));
    } catch (err) { showAlert(err.message, true); }
}

async function renderAccountsTable() {
    try {
        const users = await safeFetch(`${API_URL}/users`, { headers: getHeaders() });
        document.querySelector('#accounts-table tbody').innerHTML = users.map(u => `
            <tr>
                <td><strong>${u.email}</strong></td>
                <td><span class="role-pill role-${u.role}">${u.role}</span></td>
                <td>${new Date(u.created_at).toLocaleDateString()}</td>
                <td><button class="del-btn" style="padding:5px 10px" onclick="deleteAccount(${u.id})">Delete</button></td>
            </tr>
        `).join('');
    } catch (err) { showAlert("Error fetching accounts", true); }
}

document.getElementById('account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        await safeFetch(`${API_URL}/users`, { 
            method: 'POST', headers: getHeaders(), 
            body: JSON.stringify({
                role: document.getElementById('acc_role').value,
                email: document.getElementById('acc_email').value.trim(),
                password: document.getElementById('acc_password').value
            }) 
        });
        showAlert("Account created!");
        document.getElementById('account-form').reset();
        renderAccountsTable();
    } catch (err) { showAlert(err.message, true); }
});

async function deleteAccount(id) {
    if (!confirm("Delete this account?")) return;
    try {
        await safeFetch(`${API_URL}/users/${id}`, { method: 'DELETE', headers: getHeaders() });
        showAlert("Account deleted!");
        renderAccountsTable();
    } catch (err) { showAlert(err.message, true); }
}

window.onload = () => { if(localStorage.getItem('token')) initApp(); }
