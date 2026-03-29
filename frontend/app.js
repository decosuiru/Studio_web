const API_URL = 'http://localhost:3000/api';
let currentUser, currentToken;
let fullCalendarInstance = null;
let allBookings =[];

// [NEW] Rupiah Formatter
const formatIDR = (number) => {
    return new Intl.NumberFormat('id-ID', { 
        style: 'currency', 
        currency: 'IDR', 
        minimumFractionDigits: 0 
    }).format(number || 0);
};

function showAlert(msg, isError = false) {
    const alertBox = document.getElementById('alert-box');
    alertBox.textContent = msg;
    alertBox.className = `alert ${isError ? 'error' : ''}`;
    setTimeout(() => alertBox.classList.add('hidden'), 3000);
}

function getHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` };
}

// --- INITIALIZATION ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

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
    document.getElementById('user-info').textContent = `${currentUser.name}`;

    if (currentUser.role !== 'Admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));

    showSection('calendar');
}

// --- NAVIGATION & DATA SYNC ---
async function showSection(section) {
    document.querySelectorAll('.section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${section}-section`).classList.remove('hidden');
    document.getElementById('section-title').textContent = section.charAt(0).toUpperCase() + section.slice(1);

    await fetchAllBookings();

    if (section === 'calendar') renderCalendar();
    if (section === 'bookings') renderListTable();
    if (section === 'finance' && currentUser.role === 'Admin') renderFinanceTable();
    
    // [NEW] Accounts trigger
    if (section === 'accounts' && currentUser.role === 'Admin') renderAccountsTable();
}



async function fetchAllBookings() {
    try {
        const res = await fetch(`${API_URL}/bookings`, { headers: getHeaders() });
        allBookings = await res.json();
    } catch (err) { showAlert("Error fetching data", true); }
}

// --- CALENDAR IMPLEMENTATION ---
function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    const getEvColor = (status) => status === 'Paid' ? '#22c55e' : (status === 'Partial' ? '#f97316' : '#ef4444');

    const events = allBookings.map(b => ({
        id: b.id,
        title: `${b.client_name} - ${b.studio}`,
        start: `${b.date}T${b.start_time}`,
        end: `${b.date}T${b.end_time}`,
        backgroundColor: getEvColor(b.status),
        extendedProps: b
    }));

    if (fullCalendarInstance) fullCalendarInstance.destroy();

    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        
        // [NEW] Add these two lines for layout control:
        height: '100%', 
        stickyHeaderDates: true, 

        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
        editable: true,
        events: events,
        eventClick: (info) => openDetailModal(info.event.extendedProps),
        eventDrop: async (info) => {
            // ... (keep existing drag & drop logic)
        }
    });
    fullCalendarInstance.render();
}

// --- LIST & FINANCE RENDERERS ---
function renderListTable() {
    const tbody = document.querySelector('#bookings-table tbody');
    tbody.innerHTML = allBookings.map(b => `
        <tr>
            <td><strong>${b.client_name}</strong></td>
            <td>${b.date}</td>
            <td>${b.start_time} - ${b.end_time}</td>
            <td>${b.studio}</td>
            <td><span class="status-pill status-${b.status}">${b.status}</span></td>
            <!-- [NEW] Detail Button instead of Edit -->
            <td><button style="padding: 5px; background: #64748b;" onclick="openDetailModalById(${b.id})">Detail</button></td>
        </tr>
    `).join('');
}

// --- 1. FINANCE TABLE UPDATES ---
function renderFinanceTable() {
    let gross = 0, dp = 0, remain = 0;
    const tbody = document.querySelector('#finance-table tbody');
    
    tbody.innerHTML = allBookings.map(b => {
        gross += b.total_price; 
        dp += b.dp_paid; 
        remain += b.remaining_payment;
        return `<tr>
            <td>${b.client_name}</td>
            <td>${b.date}</td>
            <td>${formatIDR(b.total_price)}</td>
            <td>${formatIDR(b.dp_paid)}</td>
            <td class="danger-text">${formatIDR(b.remaining_payment)}</td>
            <td><span class="status-pill status-${b.status}">${b.status}</span></td>
        </tr>`;
    }).join('');

    // Update Finance Summary Cards
    document.getElementById('fin-income').textContent = formatIDR(gross);
    document.getElementById('fin-dp').textContent = formatIDR(dp);
    document.getElementById('fin-remain').textContent = formatIDR(remain);
}


// --- MODAL LOGIC: DETAILS ---
function openDetailModalById(id) {
    const b = allBookings.find(x => x.id === id);
    if(b) openDetailModal(b);
}

// [NEW] Maps booking data to the visual Detail Card
function openDetailModal(b) {
    document.getElementById('det_name').textContent = b.client_name;
    document.getElementById('det_phone').textContent = b.client_phone;
    document.getElementById('det_email').textContent = b.client_email || "N/A";
    document.getElementById('det_date').textContent = b.date;
    document.getElementById('det_time').textContent = `${b.start_time} - ${b.end_time}`;
    document.getElementById('det_studio').textContent = b.studio;
    
    // Format to Rupiah
    document.getElementById('det_total').textContent = formatIDR(b.total_price);
    document.getElementById('det_dp').textContent = formatIDR(b.dp_paid);
    document.getElementById('det_remain').textContent = formatIDR(b.remaining_payment);
    
    const statusEl = document.getElementById('det_status');
    statusEl.textContent = b.status;
    statusEl.className = `status-pill status-${b.status}`;

    document.getElementById('btn-edit-from-detail').onclick = () => openEditModal(b);
    document.getElementById('delete-btn').onclick = () => deleteFromModal(b.id);
    
    document.getElementById('detail-modal').classList.remove('hidden');
}

function closeDetailModal() {
    document.getElementById('detail-modal').classList.add('hidden');
}

// --- MODAL LOGIC: BOOKING FORM ---
function calcRemaining() {
    const p = parseFloat(document.getElementById('total_price').value) || 0;
    const dp = parseFloat(document.getElementById('dp_paid').value) || 0;
    
    // Format live calculation to Rupiah
    document.getElementById('remaining-text').textContent = formatIDR(p - dp);
}

function openBookingModal() {
    document.getElementById('booking-form').reset();
    document.getElementById('booking_id').value = "";
    document.getElementById('modal-title').textContent = "New Booking";
    calcRemaining();
    document.getElementById('booking-modal').classList.remove('hidden');
}

// [REPLACED] Populates form using direct fields
function openEditModal(b) {
    closeDetailModal(); // Hide detail card first
    
    document.getElementById('booking_id').value = b.id;
    document.getElementById('modal-title').textContent = "Edit Booking";
    
    document.getElementById('client_name').value = b.client_name;
    document.getElementById('client_phone').value = b.client_phone;
    document.getElementById('client_email').value = b.client_email || "";
    document.getElementById('date').value = b.date;
    document.getElementById('start_time').value = b.start_time;
    document.getElementById('end_time').value = b.end_time;
    document.getElementById('studio').value = b.studio;
    document.getElementById('total_price').value = b.total_price;
    document.getElementById('dp_paid').value = b.dp_paid;
    
    calcRemaining();
    document.getElementById('booking-modal').classList.remove('hidden');
}

function closeBookingModal() { 
    document.getElementById('booking-modal').classList.add('hidden'); 
}

// --- SAVE & DELETE ---
document.getElementById('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    // 1. [THE FIX] Build payload directly from inputs. NO client_id logic.
    const payload = {
        client_name: document.getElementById('client_name').value.trim(),
        client_phone: document.getElementById('client_phone').value.trim(),
        client_email: document.getElementById('client_email').value.trim(), // Optional
        date: document.getElementById('date').value,
        start_time: document.getElementById('start_time').value,
        end_time: document.getElementById('end_time').value,
        studio: document.getElementById('studio').value,
        total_price: parseFloat(document.getElementById('total_price').value) || 0,
        dp_paid: parseFloat(document.getElementById('dp_paid').value) || 0
    };

    const bookingId = document.getElementById('booking_id').value;
    const method = bookingId ? 'PUT' : 'POST';
    const url = bookingId ? `${API_URL}/bookings/${bookingId}` : `${API_URL}/bookings`;

    try {
        const res = await fetch(url, { 
            method, 
            headers: getHeaders(), 
            body: JSON.stringify(payload) 
        });
        
        const data = await res.json();
        
        // Catch validation errors thrown by the clean backend
        if (!res.ok) throw new Error(data.error);

        showAlert(bookingId ? "Booking Updated!" : "Booking Saved!");
        closeBookingModal();
        
        // Refresh Current View
        await fetchAllBookings();
        if(!document.getElementById('calendar-section').classList.contains('hidden')) renderCalendar();
        if(!document.getElementById('bookings-section').classList.contains('hidden')) renderListTable();
        if(!document.getElementById('finance-section').classList.contains('hidden')) renderFinanceTable();
        
    } catch (err) { 
        showAlert(err.message, true); 
    }
});

async function deleteFromModal(id) {
    if (!confirm("Delete this booking?")) return;
    try {
        await fetch(`${API_URL}/bookings/${id}`, { method: 'DELETE', headers: getHeaders() });
        showAlert("Deleted!");
        closeDetailModal();
        await fetchAllBookings();
        renderCalendar();
        renderListTable();
        renderFinanceTable();
    } catch (err) { showAlert("Error deleting", true); }
}

// --- [NEW] ACCOUNTS MANAGEMENT ---

async function renderAccountsTable() {
    try {
        const res = await fetch(`${API_URL}/users`, { headers: getHeaders() });
        
        // 1. Check if the response is actually JSON before parsing
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("Server returned HTML instead of JSON. Check your backend routes.");
        }

        const users = await res.json();
        if (!res.ok) throw new Error(users.error || "Failed to fetch accounts");

        const tbody = document.querySelector('#accounts-table tbody');
        
        tbody.innerHTML = users.map(u => {
            // Safely handle missing dates
            const date = u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A';
            return `<tr>
                <td><strong>${u.email}</strong></td>
                <td><span class="role-pill role-${u.role}">${u.role}</span></td>
                <td>${date}</td>
                <td>
                    <button class="del-btn" style="padding:5px 10px" onclick="deleteAccount(${u.id})">Delete</button>
                </td>
            </tr>`;
        }).join('');
    } catch (err) { 
        console.error("Accounts Table Error:", err);
        showAlert(err.message, true); 
    }
}

document.getElementById('account-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const payload = {
        role: document.getElementById('acc_role').value,
        email: document.getElementById('acc_email').value.trim(),
        password: document.getElementById('acc_password').value
    };

    try {
        const res = await fetch(`${API_URL}/users`, { 
            method: 'POST', 
            headers: getHeaders(), 
            body: JSON.stringify(payload) 
        });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.error);

        showAlert("Account created successfully!");
        document.getElementById('account-form').reset();
        renderAccountsTable(); // refresh table
    } catch (err) { showAlert(err.message, true); }
});

async function deleteAccount(id) {
    if (!confirm("Are you sure you want to delete this account?")) return;
    try {
        const res = await fetch(`${API_URL}/users/${id}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        
        showAlert("Account deleted!");
        renderAccountsTable();
    } catch (err) { showAlert(err.message, true); }
}

window.onload = () => { if(localStorage.getItem('token')) initApp(); }