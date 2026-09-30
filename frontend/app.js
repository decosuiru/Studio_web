const API_URL = 'https://studioweb-production.up.railway.app/api'; 
const SOCKET_URL = API_URL.replace('/api', '');

let currentUser, currentToken;
let fullCalendarInstance = null;
let allBookings = [];
let allPettyCash =[];
let socket = null;
let inactivityTimer;
let lastClickedDate = null; 
let currentBaseDP = 0;
let alertTimeout; 
let currentViewedBooking = null; 

let viewModeBookings = 'upcoming';
let viewModeFinance = 'upcoming';

const formatIDR = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num || 0);

// [UPDATED] FORMAT TANGGAL INDONESIA (DD/MM/YYYY)
function formatDateID(dateInput) {
    if (!dateInput) return '';
    
    let d = dateInput;
    // Jika input berupa string dari database (YYYY-MM-DD), potong aman agar tidak terpengaruh Timezone
    if (typeof dateInput === 'string') {
        const onlyDate = dateInput.split('T')[0];
        if (onlyDate.includes('-')) {
            const [yyyy, mm, dd] = onlyDate.split('-');
            if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;
        }
        d = new Date(dateInput);
    }
    
    if (isNaN(d)) return dateInput;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// [UPDATED] FORMAT TANGGAL & WAKTU (DD/MM/YYYY HH:MM)
function formatDateTime(ts) {
    if(!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return ts;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatPhone(phone) {
    if (!phone) return '';
    const cleaned = ('' + phone).replace(/\D/g, ''); 
    const match = cleaned.match(/.{1,4}/g); 
    return match ? match.join('-') : phone;
}

function showAlert(msg, isError = false) {
    const alertBox = document.getElementById('alert-box');
    clearTimeout(alertTimeout);
    alertBox.textContent = msg;
    alertBox.className = `ios-alert ${isError ? 'error' : ''}`;
    alertBox.classList.remove('hidden', 'closing');
    
    alertTimeout = setTimeout(() => {
        alertBox.classList.add('closing');
        setTimeout(() => { alertBox.classList.add('hidden'); alertBox.classList.remove('closing'); }, 300);
    }, 3000);
}

function closeModalAnim(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('closing');
    setTimeout(() => { modal.classList.add('hidden'); modal.classList.remove('closing'); }, 200);
}

function safeSetHTML(id, val) { const el = document.getElementById(id); if(el) el.innerHTML = val; }
function safeSetText(id, val) { const el = document.getElementById(id); if(el) el.textContent = val; }

function getHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` };
}

async function safeFetch(url, options = {}) {
    try {
        const res = await fetch(url, options);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) throw new Error("API Route Error");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Server error");
        return data;
    } catch (err) { throw err; }
}

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (sessionStorage.getItem('token')) inactivityTimer = setTimeout(logout, 15 * 60 * 1000); 
}
document.onmousemove = document.onkeypress = document.onclick = document.onscroll = resetInactivityTimer;

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const data = await safeFetch(`${API_URL}/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('email').value, password: document.getElementById('password').value })
        });
        sessionStorage.setItem('token', data.token);
        sessionStorage.setItem('user', JSON.stringify(data.user));
        initApp();
    } catch (err) { showAlert(err.message, true); }
});

function logout() { sessionStorage.clear(); window.location.reload(); }

function initApp() {
    currentToken = sessionStorage.getItem('token');
    if (!currentToken) return;

    currentUser = JSON.parse(sessionStorage.getItem('user'));
    
    const loginView = document.getElementById('login-view');
    loginView.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => {
        loginView.classList.add('hidden');
        loginView.style.animation = '';
        document.getElementById('app-view').classList.remove('hidden');
        
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if(btn.textContent.includes('Calendar')) btn.classList.add('active');
        });
    }, 300);
    
    if (currentUser.role !== 'Admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
    
    initRealTime();
    showSection('calendar');
    resetInactivityTimer();
}

function initRealTime() {
    if (!socket) {
        socket = io(SOCKET_URL);
        socket.on('connect', () => { const el = document.getElementById('sync-status'); if(el) el.style.display = 'block'; });
        socket.on('disconnect', () => { const el = document.getElementById('sync-status'); if(el) el.style.display = 'none'; });
        socket.on('bookings_changed', async () => { await fetchAllBookings(); refreshActiveSection(); });
        socket.on('finance_changed', async () => { await fetchPettyCash(); refreshActiveSection(); });
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

async function showSection(section) {
    document.querySelectorAll('.section').forEach(el => el.classList.add('hidden'));
    const secEl = document.getElementById(`${section}-section`);
    if(secEl) secEl.classList.remove('hidden');
    
    const titleEl = document.getElementById('section-title');
    if(titleEl) titleEl.textContent = section.charAt(0).toUpperCase() + section.slice(1).replace('cash', ' Cash');

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
        if(btn.getAttribute('onclick').includes(section)) btn.classList.add('active');
    });

    if (document.getElementById('sidebar').classList.contains('open')) toggleSidebar();

    await fetchAllBookings();
    if (section === 'pettycash') await fetchPettyCash();

    refreshActiveSection();
}

function refreshActiveSection() {
    const activeEl = document.querySelector('.section:not(.hidden)');
    if(!activeEl) return;
    const active = activeEl.id.replace('-section', '');
    if (active === 'calendar') renderCalendar();
    if (active === 'bookings') renderListTable();
    if (active === 'finance') renderFinanceTable();
    if (active === 'pettycash') renderPettyCash();
    if (active === 'accounts') renderAccountsTable();
}

async function fetchAllBookings() { try { allBookings = await safeFetch(`${API_URL}/bookings`, { headers: getHeaders() }); } catch (err) {} }
async function fetchPettyCash() { try { allPettyCash = await safeFetch(`${API_URL}/petty_cash`, { headers: getHeaders() }); } catch (err) {} }

function isBookingRecent(dateStr, endTimeStr) {
    return new Date(`${dateStr.split('T')[0]}T${endTimeStr}`) < new Date();
}

function isBookingOngoing(dateStr, startStr, endStr) {
    const now = new Date();
    const start = new Date(`${dateStr.split('T')[0]}T${startStr}`);
    const end = new Date(`${dateStr.split('T')[0]}T${endStr}`);
    return now >= start && now <= end;
}

function getDateRange(filterType, customStart, customEnd) {
    const now = new Date();
    let start, end;
    if (filterType === 'day') {
        start = new Date(now.setHours(0,0,0,0));
        end = new Date(now.setHours(23,59,59,999));
    } else if (filterType === 'week') {
        const first = now.getDate() - now.getDay();
        start = new Date(new Date().setDate(first)); start.setHours(0,0,0,0);
        end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999);
    } else if (filterType === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23,59,59,999);
    } else if (filterType === 'custom' && customStart && customEnd) {
        start = new Date(customStart); start.setHours(0,0,0,0);
        end = new Date(customEnd); end.setHours(23,59,59,999);
    } else {
        return null; 
    }
    return { start, end };
}

function handleFinanceFilter() {
    const val = document.getElementById('finance-filter').value;
    const custom = document.getElementById('finance-custom');
    if(val === 'custom') { custom.classList.remove('hidden'); custom.classList.add('flex-row'); }
    else { custom.classList.add('hidden'); custom.classList.remove('flex-row'); renderFinanceTable(); }
}

function handlePcFilter() {
    const val = document.getElementById('pc-filter').value;
    const custom = document.getElementById('pc-custom');
    if(val === 'custom') { custom.classList.remove('hidden'); custom.classList.add('flex-row'); }
    else { custom.classList.add('hidden'); custom.classList.remove('flex-row'); renderPettyCash(); }
}

function toggleBookingView(mode) {
    viewModeBookings = mode;
    document.querySelectorAll('#bookings-section .seg-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-booking-${mode}`).classList.add('active');
    renderListTable();
}

function toggleFinanceView(mode) {
    viewModeFinance = mode;
    document.querySelectorAll('#finance-section .seg-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-finance-${mode}`).classList.add('active');
    renderFinanceTable();
}

function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    if(!calendarEl) return;
    const isMobile = window.innerWidth <= 768;

    const events = allBookings.map(b => ({
        id: b.id, title: b.client_name, 
        start: `${b.date.split('T')[0]}T${b.start_time}`, end: `${b.date.split('T')[0]}T${b.end_time}`,
        backgroundColor: isMobile ? 'var(--text-secondary)' : (b.status === 'Paid' ? 'var(--system-green)' : (b.status === 'Partial' ? 'var(--system-orange)' : 'var(--system-red)')),
        extendedProps: b
    }));

    if (fullCalendarInstance) fullCalendarInstance.destroy();
    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth', height: isMobile ? 'auto' : '100%', contentHeight: 'auto',
        headerToolbar: { left: 'prev,next today', center: 'title', right: isMobile ? '' : 'dayGridMonth,timeGridWeek,timeGridDay' },
        editable: false, events: events,
        eventClick: (info) => { if(!isMobile) openDetailModal(info.event.extendedProps); },
        dateClick: (info) => { 
            if (isMobile) {
                if (lastClickedDate === info.dateStr) {
                    fullCalendarInstance.changeView('timeGridDay', info.dateStr);
                    lastClickedDate = null; return;
                }
                lastClickedDate = info.dateStr; 
                document.querySelectorAll('.selected-date').forEach(el => el.classList.remove('selected-date'));
                info.dayEl.classList.add('selected-date');

                const dayBookings = allBookings.filter(b => b.date.split('T')[0] === info.dateStr);
                const itemsEl = document.getElementById('mobile-event-items');
                
                // Format Indonesia di header kalender mobile
                document.getElementById('mobile-event-date').textContent = new Date(info.dateStr).toLocaleDateString('id-ID', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
                document.getElementById('mobile-event-list').classList.remove('hidden');
                
                if (dayBookings.length === 0) itemsEl.innerHTML = '<p class="text-secondary text-center mt-20">No Events</p>';
                else itemsEl.innerHTML = dayBookings.map(b => `
                    <div class="mobile-event-card" onclick="openDetailModalById(${b.id})">
                        <div class="flex-col gap-10"><span class="font-bold text-primary">${b.start_time.substring(0,5)}</span><span class="font-medium">${b.client_name}</span></div>
                        <div><span class="ios-badge badge-${b.status.toLowerCase()}">${b.status}</span></div>
                    </div>`).join('');
            } else fullCalendarInstance.changeView('timeGridDay', info.dateStr);
        }
    });
    fullCalendarInstance.render();
}

function renderListTable() {
    const tbody = document.querySelector('#bookings-table tbody');
    const ongoingContainer = document.getElementById('ongoing-session-container');
    if(!tbody) return;

    const ongoingBookings = allBookings.filter(b => isBookingOngoing(b.date, b.start_time, b.end_time));
    if (ongoingContainer) {
        if (ongoingBookings.length > 0) {
            ongoingContainer.innerHTML = ongoingBookings.map(b => `
                <div class="ios-live-card" onclick="openDetailModalById(${b.id})">
                    <div class="flex-1">
                        <div style="font-size: 11px; font-weight: 700; color: var(--system-green); letter-spacing: 1px; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                            <span class="live-dot"></span> ONGOING SESSION
                        </div>
                        <div style="font-size: 20px; font-weight: 700; margin-bottom: 4px;">${b.client_name}</div>
                        <div style="font-size: 13px; color: var(--text-secondary); font-weight: 500;">${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)} | ${b.customer_type}</div>
                    </div>
                    <div><span class="ios-badge badge-${b.status.toLowerCase()}" style="font-size: 13px; padding: 6px 14px;">${b.status}</span></div>
                </div>
            `).join('');
        } else { ongoingContainer.innerHTML = ''; }
    }

    let filtered = allBookings.filter(b => {
        const recent = isBookingRecent(b.date, b.end_time);
        return viewModeBookings === 'upcoming' ? !recent : recent;
    });

    if (viewModeBookings === 'recent') filtered.sort((a, b) => new Date(b.date.split('T')[0]+'T'+b.end_time) - new Date(a.date.split('T')[0]+'T'+a.end_time));
    else filtered.sort((a, b) => new Date(a.date.split('T')[0]+'T'+a.start_time) - new Date(b.date.split('T')[0]+'T'+b.start_time));

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-secondary p-15">No ${viewModeBookings} bookings found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(b => {
        const isLive = isBookingOngoing(b.date, b.start_time, b.end_time);
        const liveBadge = isLive ? `<span class="live-badge-inline">LIVE</span>` : '';
        const received = parseFloat(b.dp_paid) + parseFloat(b.settlement_paid);
        return `
        <tr style="${isLive ? 'background: rgba(52, 199, 89, 0.05);' : ''}">
            <td>${formatDateID(b.date)}</td>
            <td class="hide-mobile font-medium">${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}</td>
            <td><strong style="color: var(--text-main);">${b.client_name}</strong> ${liveBadge}</td>
            <td class="hide-mobile">${b.customer_type}</td>
            <td class="hide-mobile text-green">${formatIDR(received)}</td>
            <td><span class="ios-badge badge-${b.status.toLowerCase()}">${b.status}</span></td>
            <td><button class="ios-btn ios-btn-secondary small-btn" onclick="openDetailModalById(${b.id})">Detail</button></td>
        </tr>
    `}).join('');
}

function renderFinanceTable() {
    const filterType = document.getElementById('finance-filter').value;
    const range = getDateRange(filterType, document.getElementById('fin-start').value, document.getElementById('fin-end').value);
    
    let allTransactions =[];
    let gross = 0, dpTotal = 0, remainTotal = 0;

    allBookings.forEach(b => {
        const dp = parseFloat(b.dp_paid) || 0;
        const settle = parseFloat(b.settlement_paid) || 0;
        const total = parseFloat(b.total_price) || 0;
        const eventDate = new Date(`${b.date.split('T')[0]}T${b.start_time}`);
        const bookingCreateDate = new Date(b.created_at || b.dp_time || eventDate);

        let isBookingInRange = true;
        if (range && (bookingCreateDate < range.start || bookingCreateDate > range.end)) isBookingInRange = false;

        if (isBookingInRange) {
            gross += total;
            remainTotal += parseFloat(b.remaining_payment) || 0;
        }

        if (dp > 0 || total === 0) {
            let typeLabel = total === 0 ? "Management" : (dp >= total && settle === 0 ? "Full Payment" : "DP / First");
            let txDate = new Date(b.dp_time || b.created_at || eventDate);
            let isTxInRange = true;
            if (range && (txDate < range.start || txDate > range.end)) isTxInRange = false;

            if (isTxInRange) {
                allTransactions.push({ booking: b, date: txDate, amount: dp, type: typeLabel });
                dpTotal += dp; 
            }
        }

        if (settle > 0) {
            let txDate = new Date(b.settlement_time || b.created_at || eventDate);
            let isTxInRange = true;
            if (range && (txDate < range.start || txDate > range.end)) isTxInRange = false;

            if (isTxInRange) {
                allTransactions.push({ booking: b, date: txDate, amount: settle, type: "Settlement" });
                dpTotal += settle; 
            }
        }
    });

    safeSetText('fin-income', formatIDR(gross));
    safeSetText('fin-dp', formatIDR(dpTotal));
    safeSetText('fin-remain', formatIDR(remainTotal));

    allTransactions.sort((a, b) => b.date - a.date);

    const tbody = document.querySelector('#finance-table tbody');
    if(!tbody) return;

    if (allTransactions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-secondary p-15">No transactions found.</td></tr>`;
        return;
    }

    tbody.innerHTML = allTransactions.map(tx => {
        const b = tx.booking;
        return `
        <tr>
            <td>
                <strong style="color: var(--text-main);">${formatDateID(tx.date)}</strong><br>
                <span class="text-secondary" style="font-size: 12px;">${tx.date.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'})}</span>
            </td>
            <td>
                <strong style="color: var(--text-main);">${b.client_name}</strong><br>
                <span class="text-secondary" style="font-size: 12px;">📞 ${formatPhone(b.client_phone)}</span>
            </td>
            <td class="hide-mobile">${formatIDR(b.total_price)}</td>
            <td><span class="ios-badge badge-paid">${tx.type}</span></td>
            <td class="text-green font-medium">+ ${formatIDR(tx.amount)}</td>
            <td><span class="ios-badge badge-${b.status.toLowerCase()}">${b.status}</span></td>
        </tr>
        `;
    }).join('');
}

function renderPettyCash() {
    const filterType = document.getElementById('pc-filter').value;
    const range = getDateRange(filterType, document.getElementById('pc-start').value, document.getElementById('pc-end').value);
    
    let filteredRange = allPettyCash;
    if (range) {
        filteredRange = allPettyCash.filter(t => {
            const d = new Date(t.date);
            return d >= range.start && d <= range.end;
        });
    }

    let filteredOut = 0;
    filteredRange.forEach(t => {
        if(t.type === 'OUT') filteredOut += parseFloat(t.amount);
    });

    let totalIn = 0, totalOut = 0;
    allPettyCash.forEach(t => { if(t.type === 'IN') totalIn += parseFloat(t.amount); else totalOut += parseFloat(t.amount); });

    safeSetText('pc-out', formatIDR(filteredOut));
    safeSetText('pc-balance', formatIDR(totalIn - totalOut));

    const tbody = document.querySelector('#pc-table tbody');
    if(!tbody) return;

    if (filteredRange.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-secondary p-15">No transactions found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredRange.map(t => `
        <tr>
            <td style="color: var(--text-main);">${formatDateID(t.date)}</td>
            <td style="color: var(--text-main);">${t.description}</td>
            <td class="hide-mobile"><span class="ios-badge badge-${t.type.toLowerCase()}">${t.type}</span></td>
            <td class="${t.type==='IN'?'text-green':'text-red'} font-medium">${t.type==='IN'?'+':'-'} ${formatIDR(t.amount)}</td>
            <td><button class="ios-btn ios-btn-secondary small-btn" onclick="openPcDetailModalById(${t.id})">Detail</button></td>
        </tr>
    `).join('');
}

async function withdrawAllPettyCash() {
    let totalIn = 0, totalOut = 0;
    allPettyCash.forEach(t => { if(t.type === 'IN') totalIn += parseFloat(t.amount); else totalOut += parseFloat(t.amount); });
    const balance = totalIn - totalOut;
    
    if (balance <= 0) return showAlert("Current balance is already 0.", true);
    if (!confirm(`Are you sure you want to withdraw the full balance of ${formatIDR(balance)}? This will record an OUT transaction and reset the safe to 0.`)) return;

    try {
        await safeFetch(`${API_URL}/petty_cash`, { 
            method: 'POST', headers: getHeaders(), 
            body: JSON.stringify({
                date: new Date().toISOString().split('T')[0],
                description: "Management Withdrawal",
                type: "OUT",
                amount: balance
            }) 
        });
        showAlert("Balance reset successfully!");
    } catch(err) { showAlert(err.message, true); }
}

function openPcDetailModalById(id) { const t = allPettyCash.find(x => x.id === id); if(t) openPcDetailModal(t); }

function openPcDetailModal(t) {
    safeSetText('pc_det_date', formatDateID(t.date));
    safeSetText('pc_det_desc', t.description);
    
    const typeEl = document.getElementById('pc_det_type');
    if(typeEl) {
        typeEl.textContent = t.type;
        typeEl.className = `ios-badge badge-${t.type.toLowerCase()}`;
    }

    const amtEl = document.getElementById('pc_det_amount');
    if(amtEl) {
        amtEl.textContent = formatIDR(t.amount);
        amtEl.className = t.type === 'IN' ? 'text-green text-lg' : 'text-red text-lg';
    }

    document.getElementById('btn-edit-pc').onclick = () => openEditPcModal(t);
    document.getElementById('btn-del-pc').onclick = () => deletePettyCash(t.id);
    document.getElementById('pc-detail-modal').classList.remove('hidden', 'closing');
}
function closePcDetailModal() { closeModalAnim('pc-detail-modal'); }

function openPcModal() {
    document.getElementById('pc-form').reset();
    document.getElementById('pc_id').value = "";
    safeSetText('pc-modal-title', "Add Petty Cash");
    document.getElementById('pc-modal').classList.remove('hidden', 'closing');
}
function openEditPcModal(t) {
    closePcDetailModal();
    document.getElementById('pc_id').value = t.id;
    safeSetText('pc-modal-title', "Edit Petty Cash");
    document.getElementById('pc_date').value = t.date.split('T')[0];
    document.getElementById('pc_desc').value = t.description;
    document.getElementById('pc_type').value = t.type;
    document.getElementById('pc_amount').value = t.amount;
    document.getElementById('pc-modal').classList.remove('hidden', 'closing');
}
function closePcModal() { closeModalAnim('pc-modal'); }

function generateInvoiceNo(b) {
    if (b.invoice_no && !b.invoice_no.includes('OLD')) return b.invoice_no;
    const d = new Date(b.created_at || b.date); 
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    
    const sameDayBookings = allBookings.filter(bk => {
        const bkDate = new Date(bk.created_at || bk.date);
        return bkDate.getFullYear() === d.getFullYear() && bkDate.getMonth() === d.getMonth() && bkDate.getDate() === d.getDate();
    });
    sameDayBookings.sort((x, y) => x.id - y.id);
    const index = sameDayBookings.findIndex(bk => bk.id === b.id);
    const seq = String(index !== -1 ? index + 1 : 1).padStart(3, '0'); 
    return `JNS-INV/${dd}${mm}${yy}${seq}`;
}

// --- PRINT INVOICE ---
function printInvoice() {
    if (!currentViewedBooking) return;
    const b = currentViewedBooking;
    const invNo = generateInvoiceNo(b);

    document.getElementById('print_inv_no').textContent = invNo;
    document.getElementById('print_name').textContent = b.client_name;
    document.getElementById('print_phone').textContent = formatPhone(b.client_phone);
    document.getElementById('print_type').textContent = b.customer_type;
    document.getElementById('print_category').textContent = b.category || 'Custom'; 
    document.getElementById('print_status').textContent = b.status;
    document.getElementById('print_date').textContent = formatDateID(b.date);
    document.getElementById('print_time').textContent = `${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}`;
    document.getElementById('print_total').textContent = formatIDR(b.total_price);
    document.getElementById('print_dp').textContent = formatIDR(b.dp_paid);
    
    const settleRow = document.getElementById('print_settle_row');
    if (parseFloat(b.settlement_paid) > 0) {
        settleRow.style.display = 'table-row';
        document.getElementById('print_settle').textContent = formatIDR(b.settlement_paid);
    } else { settleRow.style.display = 'none'; }
    document.getElementById('print_remain').textContent = formatIDR(b.remaining_payment);

    const loader = document.createElement('div');
    loader.className = 'apple-loader-overlay';
    loader.innerHTML = `<div class="apple-spinner"></div><h3 style="color: white; font-weight: 500; font-size: 16px; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">Preparing PDF...</h3>`;
    document.body.appendChild(loader);
    requestAnimationFrame(() => loader.classList.add('show'));

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed'; iframe.style.right = '-9999px'; iframe.style.bottom = '-9999px';
    iframe.style.width = '800px'; iframe.style.height = '1131px'; 
    document.body.appendChild(iframe);

    const templateHTML = document.getElementById('invoice-template').outerHTML;
    const iframeDoc = iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(`<html><head><style>body{margin:0;padding:0;background:white;-webkit-print-color-adjust:exact;} *{box-sizing:border-box;}</style></head><body>${templateHTML}</body></html>`);
    iframeDoc.close();

    setTimeout(() => {
        const elementToPrint = iframeDoc.getElementById('invoice-template');
        const opt = {
            margin: 0.4, filename: `${invNo}.pdf`, image: { type: 'jpeg', quality: 1 },
            html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
        };
        html2pdf().set(opt).from(elementToPrint).save().then(() => {
            document.body.removeChild(iframe);
            loader.classList.remove('show');
            setTimeout(() => document.body.removeChild(loader), 300);
        }).catch((err) => {
            console.error("PDF Error: ", err);
            document.body.removeChild(iframe);
            loader.classList.remove('show');
            setTimeout(() => document.body.removeChild(loader), 300);
        });
    }, 500);
}

function openDetailModalById(id) { const b = allBookings.find(x => x.id === id); if(b) openDetailModal(b); }

function openDetailModal(b) {
    if(!b) return;
    currentViewedBooking = b; 
    const invNo = generateInvoiceNo(b);

    safeSetText('det_inv_no', invNo);
    safeSetText('det_name', b.client_name);
    safeSetText('det_type', b.customer_type);
    safeSetText('det_category', b.category || 'Custom');
    safeSetText('det_phone', formatPhone(b.client_phone));
    safeSetText('det_email', b.client_email || "N/A");
    safeSetText('det_date', formatDateID(b.date));
    safeSetText('det_time', `${b.start_time.substring(0,5)} - ${b.end_time.substring(0,5)}`);
    safeSetText('det_total', formatIDR(b.total_price));

    safeSetHTML('det_dp', `${formatIDR(b.dp_paid)} <br><span class="text-secondary" style="font-size:11px;">${formatDateTime(b.dp_time)}</span>`);
    
    const settleRow = document.getElementById('det_settlement_row');
    if (settleRow) {
        if (parseFloat(b.settlement_paid) > 0) {
            settleRow.classList.remove('hidden');
            safeSetHTML('det_settlement', `${formatIDR(b.settlement_paid)} <br><span class="text-secondary" style="font-size:11px;">${formatDateTime(b.settlement_time)}</span>`);
        } else { settleRow.classList.add('hidden'); }
    }

    safeSetText('det_remain', formatIDR(b.remaining_payment));
    safeSetText('det_status', b.status);
    const statusEl = document.getElementById('det_status');
    if(statusEl) statusEl.className = `ios-badge badge-${b.status.toLowerCase()}`;

    const editBtn = document.getElementById('btn-edit-from-detail');
    if(editBtn) editBtn.onclick = () => openEditModal(b);
    
    const delBtn = document.getElementById('delete-btn');
    if(delBtn) delBtn.onclick = () => deleteFromModal(b.id);

    const settleBtn = document.getElementById('btn-settle-from-detail');
    if (settleBtn) {
        if (b.status === 'Paid' || b.customer_type === 'Management') {
            settleBtn.style.display = 'none';
        } else {
            settleBtn.style.display = 'block';
            settleBtn.onclick = () => {
                openEditModal(b);
                setTimeout(() => document.getElementById('settlement_input')?.focus(), 300);
            };
        }
    }
    document.getElementById('detail-modal').classList.remove('hidden', 'closing');
}

function closeDetailModal() { closeModalAnim('detail-modal'); }

function handleCustomerTypeChange() {
    const type = document.getElementById('customer_type').value;
    const priceSec = document.getElementById('price-section');
    const settleSec = document.getElementById('settlement-section');
    const remainTxt = document.getElementById('remaining-text-wrapper');

    if (type === 'Management') {
        priceSec.classList.add('hidden');
        settleSec.classList.add('hidden');
        remainTxt.classList.add('hidden');
        document.getElementById('total_price').value = 0;
        document.getElementById('dp_paid').value = 0;
        document.getElementById('settlement_input').value = 0;
    } else {
        priceSec.classList.remove('hidden');
        remainTxt.classList.remove('hidden');
        
        const isEdit = !!document.getElementById('booking_id').value;
        const dp = parseFloat(document.getElementById('dp_paid').value) || 0;
        const total = parseFloat(document.getElementById('total_price').value) || 0;
        if (isEdit && dp > 0 && dp < total) settleSec.classList.remove('hidden');
    }
    calcRemaining();
}

function calcRemaining() {
    const t = parseFloat(document.getElementById('total_price').value) || 0;
    const dp = parseFloat(document.getElementById('dp_paid').value) || 0;
    const sp = parseFloat(document.getElementById('settlement_input').value) || 0;
    safeSetText('remaining-text', formatIDR(t - dp - sp));
}

function markAsFullyPaid() {
    const t = parseFloat(document.getElementById('total_price').value) || 0;
    const dp = parseFloat(document.getElementById('dp_paid').value) || 0;
    const remain = t - dp;
    if (remain > 0) {
        document.getElementById('settlement_input').value = remain;
        calcRemaining();
    }
}

function openBookingModal() {
    document.getElementById('booking-form').reset();
    document.getElementById('booking_id').value = "";
    safeSetText('modal-title', "New Booking");
    document.getElementById('settlement_input').value = 0;
    document.getElementById('booking_category').value = "";
    
    document.getElementById('price-section').classList.remove('hidden');
    document.getElementById('remaining-text-wrapper').classList.remove('hidden');
    document.getElementById('settlement-section').classList.add('hidden');

    calcRemaining();
    document.getElementById('booking-modal').classList.remove('hidden', 'closing');
}

function openEditModal(b) {
    closeModalAnim('detail-modal');
    document.getElementById('booking_id').value = b.id;
    safeSetText('modal-title', "Edit Booking");
    document.getElementById('customer_type').value = b.customer_type;
    document.getElementById('booking_category').value = b.category || "Custom"; 
    document.getElementById('client_name').value = b.client_name;
    document.getElementById('client_phone').value = b.client_phone;
    document.getElementById('client_email').value = b.client_email || "";
    document.getElementById('date').value = b.date.split('T')[0];
    document.getElementById('start_time').value = b.start_time.substring(0,5);
    document.getElementById('end_time').value = b.end_time.substring(0,5);
    document.getElementById('total_price').value = b.total_price;
    document.getElementById('dp_paid').value = b.dp_paid;
    document.getElementById('settlement_input').value = b.settlement_paid;
    
    handleCustomerTypeChange();
    document.getElementById('booking-modal').classList.remove('hidden', 'closing');
}

function closeBookingModal() { closeModalAnim('booking-modal'); }

const bookingForm = document.getElementById('booking-form');
if(bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            customer_type: document.getElementById('customer_type').value,
            category: document.getElementById('booking_category').value,
            client_name: document.getElementById('client_name').value.trim(),
            client_phone: document.getElementById('client_phone').value.trim(),
            client_email: document.getElementById('client_email').value.trim(),
            date: document.getElementById('date').value,
            start_time: document.getElementById('start_time').value,
            end_time: document.getElementById('end_time').value,
            total_price: parseFloat(document.getElementById('total_price').value) || 0,
            dp_paid: parseFloat(document.getElementById('dp_paid').value) || 0,
            settlement_paid: parseFloat(document.getElementById('settlement_input').value) || 0
        };
        if(!payload.customer_type || !payload.category) return showAlert("Please select Type & Package", true);

        const bookingId = document.getElementById('booking_id').value;
        try {
            await safeFetch(bookingId ? `${API_URL}/bookings/${bookingId}` : `${API_URL}/bookings`, { 
                method: bookingId ? 'PUT' : 'POST', headers: getHeaders(), body: JSON.stringify(payload) 
            });
            showAlert(bookingId ? "Updated!" : "Saved!");
            closeBookingModal();
        } catch (err) { showAlert(err.message, true); }
    });
}

const pcForm = document.getElementById('pc-form');
if(pcForm) {
    pcForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pcId = document.getElementById('pc_id').value;
        const payload = {
            date: document.getElementById('pc_date').value,
            description: document.getElementById('pc_desc').value.trim(),
            type: document.getElementById('pc_type').value,
            amount: parseFloat(document.getElementById('pc_amount').value)
        };
        try {
            await safeFetch(pcId ? `${API_URL}/petty_cash/${pcId}` : `${API_URL}/petty_cash`, { method: pcId ? 'PUT' : 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
            showAlert(pcId ? "Transaction updated!" : "Transaction added!");
            closePcModal();
        } catch (err) { showAlert(err.message, true); }
    });
}
async function deletePettyCash(id) {
    if(!confirm("Delete transaction?")) return;
    try { await safeFetch(`${API_URL}/petty_cash/${id}`, { method: 'DELETE', headers: getHeaders() }); showAlert("Transaction deleted"); closePcDetailModal(); } catch(err) { showAlert(err.message, true); }
}
async function deleteFromModal(id) {
    if (!confirm("Delete booking?")) return;
    try { await safeFetch(`${API_URL}/bookings/${id}`, { method: 'DELETE', headers: getHeaders() }); showAlert("Deleted!"); closeModalAnim('detail-modal'); } catch (err) { showAlert(err.message, true); }
}
async function renderAccountsTable() {
    try {
        const users = await safeFetch(`${API_URL}/users`, { headers: getHeaders() });
        const tbody = document.querySelector('#accounts-table tbody');
        if(!tbody) return;
        tbody.innerHTML = users.map(u => `<tr><td><strong style="color:var(--text-main);">${u.email}</strong></td><td><span class="ios-badge badge-${u.role.toLowerCase()}">${u.role}</span></td><td class="hide-mobile">${formatDateID(u.created_at)}</td><td><button class="ios-btn ios-btn-danger small-btn" onclick="deleteAccount(${u.id})">Delete</button></td></tr>`).join('');
    } catch (err) { console.error(err); }
}
const accForm = document.getElementById('account-form');
if(accForm) {
    accForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await safeFetch(`${API_URL}/users`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ role: document.getElementById('acc_role').value, email: document.getElementById('acc_email').value.trim(), password: document.getElementById('acc_password').value }) }); showAlert("Account created!"); document.getElementById('account-form').reset(); renderAccountsTable(); } catch (err) { showAlert(err.message, true); }
    });
}
async function deleteAccount(id) {
    if(!confirm("Delete account?")) return;
    try { await safeFetch(`${API_URL}/users/${id}`, { method: 'DELETE', headers: getHeaders() }); renderAccountsTable(); } catch (err) { showAlert(err.message, true); }
}

setInterval(() => {
    const activeEl = document.querySelector('.section:not(.hidden)');
    if (activeEl && activeEl.id === 'bookings-section') renderListTable();
}, 60000);

window.onload = () => { 
    resetInactivityTimer();
    if(sessionStorage.getItem('token')) { initApp(); }
};
