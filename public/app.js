// Frontend application logic for VPS Fee Tracker (Paid VPS + Exness Free VPS)

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// App State
const state = {
  records: [],
  activeView: 'paid',     // 'paid' | 'free' | 'all'
  selectedYear: '2026',
  activeMonth: 'October', // Default to October based on Excel data
  statusFilter: 'all',    // 'all' | 'due' | 'paid' | 'unset' (or 'all_paid' | 'all_free' in all view)
  searchQuery: '',
  selectedIds: new Set(),
  editingUserId: null,
  activePaymentTarget: null
};

// DOM Elements
const recordsTableBody = document.getElementById('recordsTableBody');
const tableThead = document.getElementById('tableThead');
const yearSelect = document.getElementById('yearSelect');
const monthBarSection = document.getElementById('monthBarSection');
const monthTabsContainer = document.getElementById('monthTabsContainer');
const filterPillsContainer = document.getElementById('filterPillsContainer');
const searchInput = document.getElementById('searchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const batchActionToolbar = document.getElementById('batchActionToolbar');
const selectedCountLabel = document.getElementById('selectedCountLabel');
const tableRecordCountSummary = document.getElementById('tableRecordCountSummary');
const dbStatusBadge = document.getElementById('dbStatusBadge');

// Navigation Tabs
const navTabPaid = document.getElementById('navTabPaid');
const navTabFree = document.getElementById('navTabFree');
const navTabAll = document.getElementById('navTabAll');
const badgePaidCount = document.getElementById('badgePaidCount');
const badgeFreeCount = document.getElementById('badgeFreeCount');
const badgeAllCount = document.getElementById('badgeAllCount');
const viewDescriptionText = document.getElementById('viewDescriptionText');

// Stat Elements
const statTotalUsers = document.getElementById('statTotalUsers');
const statAccountsBreakdown = document.getElementById('statAccountsBreakdown');
const statPaidCount = document.getElementById('statPaidCount');
const statPaidPercent = document.getElementById('statPaidPercent');
const statDueCount = document.getElementById('statDueCount');
const statUnsetCount = document.getElementById('statUnsetCount');
const statFreeCount = document.getElementById('statFreeCount');
const statCollectedFee = document.getElementById('statCollectedFee');
const statPendingFee = document.getElementById('statPendingFee');

// Modal Elements
const userModal = document.getElementById('userModal');
const userModalTitle = document.getElementById('userModalTitle');
const userForm = document.getElementById('userForm');
const userIdInput = document.getElementById('userIdInput');
const toggleTypePaid = document.getElementById('toggleTypePaid');
const toggleTypeFree = document.getElementById('toggleTypeFree');
const modalVpsTypeInput = document.getElementById('modalVpsTypeInput');
const paidVpsSection = document.getElementById('paidVpsSection');
const freeVpsSection = document.getElementById('freeVpsSection');

const modalEmailInput = document.getElementById('modalEmailInput');
const modalNameInput = document.getElementById('modalNameInput');
const modalFeeInput = document.getElementById('modalFeeInput');
const modalDateInput = document.getElementById('modalDateInput');
const modalNextDueDateInput = document.getElementById('modalNextDueDateInput');
const modalAccountNumberInput = document.getElementById('modalAccountNumberInput');
const modalServerInput = document.getElementById('modalServerInput');
const modalFreeStartDateInput = document.getElementById('modalFreeStartDateInput');
const modalNotesInput = document.getElementById('modalNotesInput');

const paymentDetailModal = document.getElementById('paymentDetailModal');
const paymentTargetUser = document.getElementById('paymentTargetUser');
const paymentTargetMonth = document.getElementById('paymentTargetMonth');
const paymentDateInput = document.getElementById('paymentDateInput');
const paymentAmountInput = document.getElementById('paymentAmountInput');
const paymentNotesInput = document.getElementById('paymentNotesInput');

const remindersModal = document.getElementById('remindersModal');
const reminderMonthTitle = document.getElementById('reminderMonthTitle');
const reminderCountBadge = document.getElementById('reminderCountBadge');
const unpaidListBox = document.getElementById('unpaidListBox');
const reminderTextTemplate = document.getElementById('reminderTextTemplate');

const importModal = document.getElementById('importModal');
const dropArea = document.getElementById('dropArea');
const excelFileInput = document.getElementById('excelFileInput');
const selectedFileName = document.getElementById('selectedFileName');
const btnSubmitImport = document.getElementById('btnSubmitImport');

// --- Authentication State & Helpers ---
const AUTH_TOKEN_KEY = 'vps_auth_token';
const AUTH_USER_KEY = 'vps_auth_user';

const loginOverlay = document.getElementById('loginOverlay');
const loginForm = document.getElementById('loginForm');
const loginUsernameInput = document.getElementById('loginUsername');
const loginPasswordInput = document.getElementById('loginPassword');
const loginRememberMe = document.getElementById('loginRememberMe');
const loginErrorBox = document.getElementById('loginErrorBox');
const loginErrorMsg = document.getElementById('loginErrorMsg');
const btnLoginSubmit = document.getElementById('btnLoginSubmit');
const btnTogglePassword = document.getElementById('btnTogglePassword');
const btnLogout = document.getElementById('btnLogout');
const loggedInUserText = document.getElementById('loggedInUserText');

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function getStoredUser() {
  return localStorage.getItem(AUTH_USER_KEY) || sessionStorage.getItem(AUTH_USER_KEY) || 'HussainIjaz';
}

function setAuthToken(token, username, remember) {
  if (remember) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, username);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
  } else {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.setItem(AUTH_USER_KEY, username);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);
}

// Global fetch wrapper to automatically attach JWT / HMAC Bearer tokens
const originalFetch = window.fetch;
window.fetch = async function (url, options = {}) {
  if (typeof url === 'string' && url.startsWith('/api/') && !url.startsWith('/api/login')) {
    const token = getAuthToken();
    if (token) {
      if (!options.headers) {
        options.headers = {};
      }
      if (options.headers instanceof Headers) {
        options.headers.set('Authorization', `Bearer ${token}`);
      } else if (Array.isArray(options.headers)) {
        options.headers.push(['Authorization', `Bearer ${token}`]);
      } else {
        options.headers['Authorization'] = `Bearer ${token}`;
      }
    }
  }

  const res = await originalFetch(url, options);

  // Auto prompt login if 401 Unauthorized received on any protected route
  if (res.status === 401 && typeof url === 'string' && !url.startsWith('/api/login') && !url.startsWith('/api/verify-token')) {
    clearAuthToken();
    showLoginOverlay('Session expired. Please sign in again.');
  }

  return res;
};

function showLoginOverlay(errorMsg = '') {
  if (loginOverlay) {
    loginOverlay.classList.remove('hidden');
    loginOverlay.classList.add('flex');
  }
  if (errorMsg && loginErrorBox && loginErrorMsg) {
    loginErrorMsg.textContent = errorMsg;
    loginErrorBox.classList.remove('hidden');
  } else if (loginErrorBox) {
    loginErrorBox.classList.add('hidden');
  }
  if (loginPasswordInput) {
    loginPasswordInput.value = '';
    loginPasswordInput.focus();
  }
}

function hideLoginOverlay() {
  if (loginOverlay) {
    loginOverlay.classList.add('hidden');
    loginOverlay.classList.remove('flex');
  }
  if (loginErrorBox) {
    loginErrorBox.classList.add('hidden');
  }
}

function initAuthUI() {
  // Password show/hide toggle
  if (btnTogglePassword && loginPasswordInput) {
    btnTogglePassword.addEventListener('click', () => {
      const isPassword = loginPasswordInput.type === 'password';
      loginPasswordInput.type = isPassword ? 'text' : 'password';
      const eyeIcon = document.getElementById('eyeIcon');
      if (eyeIcon) {
        eyeIcon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
        lucide.createIcons();
      }
    });
  }

  // Login form submit
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleLoginSubmit();
    });
  }

  if (btnLoginSubmit) {
    btnLoginSubmit.addEventListener('click', async (e) => {
      e.preventDefault();
      await handleLoginSubmit();
    });
  }

  // Logout button
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      clearAuthToken();
      state.records = [];
      renderTable();
      showLoginOverlay();
      showToast('Signed out successfully.', 'info');
    });
  }
}

async function handleLoginSubmit() {
  const username = loginUsernameInput ? loginUsernameInput.value.trim() : '';
  const password = loginPasswordInput ? loginPasswordInput.value : '';
  const rememberMe = loginRememberMe ? loginRememberMe.checked : true;

  if (!username || !password) {
    if (loginErrorBox && loginErrorMsg) {
      loginErrorMsg.textContent = 'Please enter both username and password.';
      loginErrorBox.classList.remove('hidden');
    }
    return;
  }

  if (loginErrorBox) loginErrorBox.classList.add('hidden');
  if (btnLoginSubmit) {
    btnLoginSubmit.disabled = true;
    btnLoginSubmit.innerHTML = `
      <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span>Signing In...</span>
    `;
  }

  try {
    const res = await originalFetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, rememberMe })
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = { success: false, message: `Server error (${res.status}). Please verify the server is running.` };
    }

    if (res.ok && data.success) {
      setAuthToken(data.token, data.username, rememberMe);
      if (loggedInUserText) loggedInUserText.textContent = data.username;
      hideLoginOverlay();
      showToast(`Welcome back, ${data.username}!`, 'success');
      loadData();
      checkHealth();
    } else {
      if (loginErrorBox && loginErrorMsg) {
        loginErrorMsg.textContent = data.message || 'Invalid username or password.';
        loginErrorBox.classList.remove('hidden');
      }
      if (loginPasswordInput) {
        loginPasswordInput.focus();
        loginPasswordInput.select();
      }
    }
  } catch (err) {
    if (loginErrorBox && loginErrorMsg) {
      loginErrorMsg.textContent = 'Network or server error (' + (err.message || 'connection failed') + '). Please try again.';
      loginErrorBox.classList.remove('hidden');
    }
  } finally {
    if (btnLoginSubmit) {
      btnLoginSubmit.disabled = false;
      btnLoginSubmit.innerHTML = `
        <span>Sign In to Dashboard</span>
        <i data-lucide="arrow-right" class="w-4 h-4"></i>
      `;
      lucide.createIcons();
    }
  }
}

async function verifyAuthAndInit() {
  const token = getAuthToken();
  if (!token) {
    showLoginOverlay();
    return;
  }

  try {
    const res = await originalFetch('/api/verify-token', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok && data.success && data.valid) {
      if (loggedInUserText) loggedInUserText.textContent = data.username || getStoredUser();
      hideLoginOverlay();
      checkHealth();
      loadData();
    } else {
      clearAuthToken();
      showLoginOverlay('Session expired. Please sign in again.');
    }
  } catch (err) {
    clearAuthToken();
    showLoginOverlay();
  }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initMonthTabs();
  initViewNav();
  renderFilterPills();
  renderTableThead();
  bindEvents();
  initAuthUI();
  verifyAuthAndInit();
});

// View Navigation Handling (Paid VPS | Exness Free VPS | All Accounts)
function initViewNav() {
  const tabs = [
    { btn: navTabPaid, view: 'paid' },
    { btn: navTabFree, view: 'free' },
    { btn: navTabAll, view: 'all' }
  ];

  tabs.forEach(({ btn, view }) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      switchView(view);
    });
  });
}

function switchView(view) {
  state.activeView = view;
  state.selectedIds.clear();
  updateBatchToolbar();

  [navTabPaid, navTabFree, navTabAll].forEach(t => {
    if (!t) return;
    const isCurrent = t.dataset.view === view;
    t.classList.toggle('active', isCurrent);
    if (!isCurrent) {
      t.classList.add('text-slate-400');
    } else {
      t.classList.remove('text-slate-400');
    }
  });

  if (view === 'paid') {
    if (monthBarSection) monthBarSection.classList.remove('hidden');
    if (viewDescriptionText) viewDescriptionText.textContent = 'Monthly fee & billing cycle tracker';
  } else if (view === 'free') {
    if (monthBarSection) monthBarSection.classList.add('hidden');
    if (viewDescriptionText) viewDescriptionText.textContent = 'Exness sponsored free broker VPS accounts';
  } else {
    if (monthBarSection) monthBarSection.classList.add('hidden');
    if (viewDescriptionText) viewDescriptionText.textContent = 'Consolidated master ledger (Paid + Free Exness)';
  }

  state.statusFilter = 'all';
  renderFilterPills();
  renderTableThead();
  renderTable();
}

function renderFilterPills() {
  if (!filterPillsContainer) return;

  if (state.activeView === 'paid') {
    filterPillsContainer.innerHTML = `
      <button data-filter="all" class="filter-tab active text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer">
        All Users
      </button>
      <button data-filter="due" class="filter-tab text-xs font-semibold px-3 py-1.5 rounded-md text-rose-400 hover:text-white transition cursor-pointer flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
        Need to Pay
      </button>
      <button data-filter="paid" class="filter-tab text-xs font-semibold px-3 py-1.5 rounded-md text-emerald-400 hover:text-white transition cursor-pointer flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        Paid
      </button>
      <button data-filter="unset" class="filter-tab text-xs font-semibold px-3 py-1.5 rounded-md text-slate-400 hover:text-white transition cursor-pointer">
        Unset
      </button>
    `;
  } else if (state.activeView === 'free') {
    filterPillsContainer.innerHTML = `
      <button data-filter="all" class="filter-tab active text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer flex items-center gap-1.5">
        <i data-lucide="gift" class="w-3.5 h-3.5 text-emerald-400"></i>
        <span>All Free VPS Clients</span>
      </button>
      <button data-filter="active" class="filter-tab text-xs font-semibold px-3 py-1.5 rounded-md text-emerald-400 hover:text-white transition cursor-pointer">
        Active Only
      </button>
    `;
  } else {
    filterPillsContainer.innerHTML = `
      <button data-filter="all" class="filter-tab active text-xs font-semibold px-3 py-1.5 rounded-md transition cursor-pointer">
        All Accounts (Combined)
      </button>
      <button data-filter="only_paid" class="filter-tab text-xs font-semibold px-3 py-1.5 rounded-md text-indigo-300 hover:text-white transition cursor-pointer flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
        Paid VPS Only
      </button>
      <button data-filter="only_free" class="filter-tab text-xs font-semibold px-3 py-1.5 rounded-md text-emerald-400 hover:text-white transition cursor-pointer flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
        Free Exness Only
      </button>
    `;
  }

  filterPillsContainer.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      filterPillsContainer.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.statusFilter = tab.dataset.filter;
      renderTable();
    });
  });

  lucide.createIcons();
}

function renderTableThead() {
  if (!tableThead) return;

  if (state.activeView === 'paid') {
    tableThead.innerHTML = `
      <tr>
        <th class="p-3 w-10 text-center">
          <input type="checkbox" id="selectAllCheckbox" class="rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer">
        </th>
        <th class="p-3 min-w-[200px]">User & Identity</th>
        <th class="p-3 min-w-[150px]">Billing Cycle & Next Due</th>
        <th class="p-3 w-20 text-center">Fee</th>
        <th class="p-2 text-center w-16 month-col" data-month="January">Jan</th>
        <th class="p-2 text-center w-16 month-col" data-month="February">Feb</th>
        <th class="p-2 text-center w-16 month-col" data-month="March">Mar</th>
        <th class="p-2 text-center w-16 month-col" data-month="April">Apr</th>
        <th class="p-2 text-center w-16 month-col" data-month="May">May</th>
        <th class="p-2 text-center w-16 month-col" data-month="June">Jun</th>
        <th class="p-2 text-center w-16 month-col" data-month="July">Jul</th>
        <th class="p-2 text-center w-16 month-col" data-month="August">Aug</th>
        <th class="p-2 text-center w-16 month-col" data-month="September">Sep</th>
        <th class="p-2 text-center w-16 month-col" data-month="October">Oct</th>
        <th class="p-2 text-center w-16 month-col" data-month="November">Nov</th>
        <th class="p-2 text-center w-16 month-col" data-month="December">Dec</th>
        <th class="p-3 w-20 text-right pr-4">Actions</th>
      </tr>
    `;
  } else if (state.activeView === 'free') {
    tableThead.innerHTML = `
      <tr>
        <th class="p-3 w-10 text-center">
          <input type="checkbox" id="selectAllCheckbox" class="rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer">
        </th>
        <th class="p-3 min-w-[220px]">Client & Identity</th>
        <th class="p-3 min-w-[180px]">Exness Account / Login #</th>
        <th class="p-3 min-w-[150px]">Exness Server</th>
        <th class="p-3 min-w-[130px]">Setup / Start Date</th>
        <th class="p-3 min-w-[200px]">Specs & Notes</th>
        <th class="p-3 w-28 text-center">Status</th>
        <th class="p-3 w-20 text-right pr-4">Actions</th>
      </tr>
    `;
  } else {
    tableThead.innerHTML = `
      <tr>
        <th class="p-3 w-10 text-center">
          <input type="checkbox" id="selectAllCheckbox" class="rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer">
        </th>
        <th class="p-3 w-36">VPS Type</th>
        <th class="p-3 min-w-[220px]">Client & Identity</th>
        <th class="p-3 min-w-[180px]">Account / Renewal Details</th>
        <th class="p-3 w-24 text-center">Fee</th>
        <th class="p-3 w-28 text-center">Status</th>
        <th class="p-3 min-w-[180px]">Notes</th>
        <th class="p-3 w-20 text-right pr-4">Actions</th>
      </tr>
    `;
  }

  // Re-bind master checkbox
  const newMasterCheckbox = document.getElementById('selectAllCheckbox');
  if (newMasterCheckbox) {
    newMasterCheckbox.addEventListener('change', () => {
      const isChecked = newMasterCheckbox.checked;
      document.querySelectorAll('.row-checkbox').forEach(cb => {
        cb.checked = isChecked;
        const id = cb.dataset.id;
        if (isChecked) state.selectedIds.add(id);
        else state.selectedIds.delete(id);
        const row = cb.closest('tr');
        if (row) row.classList.toggle('bg-indigo-950/20', isChecked);
      });
      updateBatchToolbar();
    });
  }
}

function initMonthTabs() {
  if (!monthTabsContainer) return;
  monthTabsContainer.innerHTML = '';
  MONTHS.forEach((m) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `month-btn ${m === state.activeMonth ? 'active' : ''}`;
    btn.dataset.month = m;
    btn.textContent = m.slice(0, 3);
    btn.title = `View status for ${m}`;

    btn.addEventListener('click', () => {
      document.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeMonth = m;
      updateActiveMonthLabels();
      renderTable();
      loadStats();
    });

    monthTabsContainer.appendChild(btn);
  });
  updateActiveMonthLabels();
}

function updateActiveMonthLabels() {
  document.querySelectorAll('.activeMonthLabel').forEach(el => {
    el.textContent = state.activeMonth;
  });
  if (reminderMonthTitle) {
    reminderMonthTitle.textContent = `${state.activeMonth} ${state.selectedYear}`;
  }
}

// --- Data Fetching ---
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (dbStatusBadge) {
      if (data.connected) {
        dbStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800/60';
        dbStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>Atlas Connected`;
      } else {
        dbStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950 text-amber-400 border border-amber-800/60';
        dbStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Offline Mode`;
      }
    }
  } catch (e) {
    console.warn('Health check failed:', e);
  }
}

async function loadData() {
  try {
    const query = new URLSearchParams({
      year: state.selectedYear,
      search: state.searchQuery
    });
    const res = await fetch(`/api/records?${query}`);
    const data = await res.json();
    if (data.success) {
      state.records = data.records;

      // Immediately sync badge and stat card counts directly from records
      const freeCount = state.records.filter(isFreeVps).length;
      const paidCount = state.records.length - freeCount;
      if (statTotalUsers) statTotalUsers.textContent = paidCount;
      if (statFreeCount) statFreeCount.textContent = freeCount;
      if (badgeFreeCount) badgeFreeCount.textContent = freeCount;
      if (badgePaidCount) badgePaidCount.textContent = paidCount;
      if (badgeAllCount) badgeAllCount.textContent = state.records.length;
      if (statAccountsBreakdown) statAccountsBreakdown.textContent = `${paidCount} Paid | ${freeCount} Free Exness`;

      renderTable();
      loadStats();
    }
  } catch (err) {
    showToast('Failed to load records: ' + err.message, 'error');
  }
}

async function loadStats() {
  try {
    const query = new URLSearchParams({
      year: state.selectedYear,
      month: state.activeMonth
    });
    const res = await fetch(`/api/stats?${query}`);
    const data = await res.json();
    if (data.success) {
      const calculatedPaid = data.totalPaidAccounts !== undefined ? data.totalPaidAccounts : (state.records.length - (data.totalFreeAccounts || 0));
      if (statTotalUsers) statTotalUsers.textContent = calculatedPaid;
      if (statAccountsBreakdown) {
        statAccountsBreakdown.textContent = `${data.totalPaidAccounts || 0} Paid | ${data.totalFreeAccounts || 0} Free Exness`;
      }
      if (badgePaidCount) badgePaidCount.textContent = data.totalPaidAccounts || 0;
      if (badgeFreeCount) badgeFreeCount.textContent = data.totalFreeAccounts || 0;
      if (badgeAllCount) badgeAllCount.textContent = data.totalUsers || 0;

      if (statPaidCount) statPaidCount.textContent = data.paidCount || 0;
      const pct = (data.totalPaidAccounts || 0) > 0 ? Math.round(((data.paidCount || 0) / data.totalPaidAccounts) * 100) : 0;
      if (statPaidPercent) statPaidPercent.textContent = `(${pct}%)`;
      if (statDueCount) statDueCount.textContent = data.dueCount || 0;
      if (statUnsetCount) statUnsetCount.textContent = data.unsetCount || 0;
      const calculatedFree = data.totalFreeAccounts !== undefined ? data.totalFreeAccounts : state.records.filter(isFreeVps).length;
      if (statFreeCount) statFreeCount.textContent = calculatedFree;
      if (badgeFreeCount) badgeFreeCount.textContent = calculatedFree;

      if (statCollectedFee) statCollectedFee.textContent = `${data.currency || '$'}${data.totalRevenuePaid || 0} collected`;
      if (statPendingFee) statPendingFee.textContent = `${data.currency || '$'}${data.totalRevenueDue || 0} due`;
    }
  } catch (e) {
    console.error('Error fetching stats:', e);
  }
}

/**
 * Dynamically computes the next unpaid due date starting from firstPaymentDate.
 */
function isFreeVps(r) {
  return r && (r.vpsType === 'free_exness' || r.monthlyFee === 0);
}

function getUpcomingDueDate(record) {
  if (!record.firstPaymentDate || !record.firstPaymentDate.trim()) return '';
  const dateStr = record.firstPaymentDate.trim();
  if (dateStr.toLowerCase().includes('unlicenc') || dateStr.toLowerCase().includes('none')) return '';

  const parts = dateStr.split('-');
  if (parts.length < 2) return record.nextDueDate || '';

  const dueDay = record.dueDay || (parts.length >= 3 ? parseInt(parts[2], 10) : 1);
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10) - 1;

  if (isNaN(y) || isNaN(m)) return record.nextDueDate || '';

  for (let i = 0; i < 36; i++) {
    const yearStr = String(y);
    const monthName = MONTHS[m];
    const status = record.payments?.[yearStr]?.[monthName]?.status;

    if (status !== 'paid') {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const day = Math.min(dueDay, daysInMonth);
      return `${yearStr}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    m++;
    if (m === 12) {
      m = 0;
      y++;
    }
  }

  return record.nextDueDate || '';
}

function calculateUpcomingFromDate(dStr) {
  if (!dStr || typeof dStr !== 'string') return '';
  const trimmed = dStr.trim();
  if (!trimmed || trimmed.toLowerCase().includes('unlicenc') || trimmed.toLowerCase().includes('none')) {
    return '';
  }
  const parts = trimmed.split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    const y = parts[0];
    const m = parts[1] - 1;
    const d = parts[2];
    const nextMonthYear = m === 11 ? y + 1 : y;
    const nextMonthIndex = m === 11 ? 0 : m + 1;
    const daysInNextMonth = new Date(nextMonthYear, nextMonthIndex + 1, 0).getDate();
    const targetDay = Math.min(d, daysInNextMonth);
    const nextDate = new Date(nextMonthYear, nextMonthIndex, targetDay);
    const resY = nextDate.getFullYear();
    const resM = String(nextDate.getMonth() + 1).padStart(2, '0');
    const resD = String(nextDate.getDate()).padStart(2, '0');
    return `${resY}-${resM}-${resD}`;
  }
  return '';
}

// --- Render Table ---
function renderTable() {
  let displayRecords = [...state.records];

  // 1. Filter by Active View (paid | free | all)
  if (state.activeView === 'paid') {
    displayRecords = displayRecords.filter(r => !isFreeVps(r));
  } else if (state.activeView === 'free') {
    displayRecords = displayRecords.filter(r => isFreeVps(r));
  }

  // 2. Apply search query
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    displayRecords = displayRecords.filter(r => 
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.email && r.email.toLowerCase().includes(q)) ||
      (r.notes && r.notes.toLowerCase().includes(q)) ||
      (r.accountNumber && r.accountNumber.toLowerCase().includes(q)) ||
      (r.server && r.server.toLowerCase().includes(q))
    );
  }

  // 3. Apply Sub-Filters
  if (state.activeView === 'paid') {
    if (state.statusFilter !== 'all') {
      displayRecords = displayRecords.filter(r => {
        const p = r.payments?.[state.selectedYear]?.[state.activeMonth]?.status || 'unset';
        return p === state.statusFilter;
      });
    }
  } else if (state.activeView === 'free') {
    if (state.statusFilter === 'active') {
      displayRecords = displayRecords.filter(r => r.status === 'active' || !r.status);
    }
  } else if (state.activeView === 'all') {
    if (state.statusFilter === 'only_paid') {
      displayRecords = displayRecords.filter(r => r.vpsType !== 'free_exness');
    } else if (state.statusFilter === 'only_free') {
      displayRecords = displayRecords.filter(r => r.vpsType === 'free_exness');
    }
  }

  // Update summary count
  const viewTitle = state.activeView === 'paid' ? 'Paid VPS records' : (state.activeView === 'free' ? 'Exness Free VPS clients' : 'Total accounts');
  if (tableRecordCountSummary) {
    tableRecordCountSummary.innerHTML = `Showing <strong>${displayRecords.length}</strong> of ${state.records.length} ${viewTitle}`;
  }

  if (displayRecords.length === 0) {
    const emptyColspan = state.activeView === 'paid' ? 17 : (state.activeView === 'free' ? 8 : 8);
    const emptyMessage = state.activeView === 'free' 
      ? 'No Exness Free VPS clients added yet. Click "Add VPS User" to add one!' 
      : 'No VPS records found. Try clearing filters or add a new record.';

    recordsTableBody.innerHTML = `
      <tr>
        <td colspan="${emptyColspan}" class="p-12 text-center text-slate-400">
          <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 text-slate-500"></i>
          <p class="font-medium text-slate-300 text-sm">${emptyMessage}</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  // Render Rows based on Active View
  if (state.activeView === 'paid') {
    renderPaidRows(displayRecords);
  } else if (state.activeView === 'free') {
    renderFreeRows(displayRecords);
  } else {
    renderAllRows(displayRecords);
  }

  attachRowEvents();
  lucide.createIcons();
  updateBatchToolbar();
}

// Row Renderer 1: Paid VPS Grid (Jan - Dec)
function renderPaidRows(records) {
  recordsTableBody.innerHTML = records.map(r => {
    const isSelected = state.selectedIds.has(r._id);
    const fee = r.monthlyFee !== undefined ? r.monthlyFee : 5;
    const currency = r.currency || '$';
    const upcomingDate = getUpcomingDueDate(r);

    // Month columns
    const monthCells = MONTHS.map(m => {
      const p = r.payments?.[state.selectedYear]?.[m];
      const status = p?.status || 'unset';
      const isActiveCol = m === state.activeMonth;

      let pillClass = 'status-unset';
      let icon = '-';
      let title = `${m}: Not set`;

      if (status === 'paid') {
        pillClass = 'status-paid';
        icon = '✓';
        title = `${m}: PAID ${p.paidDate ? '(' + p.paidDate + ')' : ''}`;
      } else if (status === 'due') {
        pillClass = 'status-due';
        icon = '!';
        title = `${m}: NEED TO PAY (Due ${p.dueDate ? p.dueDate : ''})`;
      }

      return `
        <td class="p-2 text-center ${isActiveCol ? 'active-month-col' : ''}">
          <button 
            type="button"
            class="status-pill ${pillClass}" 
            data-id="${r._id}" 
            data-month="${m}" 
            data-status="${status}"
            title="${title} (Click to cycle, Alt+Click for details)"
          >
            ${icon}
          </button>
        </td>
      `;
    }).join('');

    return `
      <tr class="hover:bg-slate-700/40 transition-colors group ${isSelected ? 'bg-indigo-950/20' : ''}" data-row-id="${r._id}">
        <td class="p-3 text-center">
          <input 
            type="checkbox" 
            class="row-checkbox rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer" 
            data-id="${r._id}"
            ${isSelected ? 'checked' : ''}
          >
        </td>
        <td class="p-3">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-bold flex items-center justify-center text-xs flex-shrink-0">
              ${(r.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-100 truncate flex items-center gap-1.5">
                <span>${escapeHtml(r.name || 'Unnamed')}</span>
              </div>
              <div class="text-xs text-slate-400 font-mono truncate">
                ${escapeHtml(r.email)}
              </div>
              ${r.notes ? `<div class="text-[11px] text-indigo-300/80 italic mt-0.5 truncate max-w-xs">${escapeHtml(r.notes)}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="p-3 text-xs text-slate-300">
          <div class="space-y-1">
            <span class="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-[11px] inline-block">
              1st: ${escapeHtml(r.firstPaymentDate || 'None')}
            </span>
            ${upcomingDate ? `
              <div class="flex items-center gap-1 text-[11px] text-amber-300 font-mono">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                <span>Next: ${escapeHtml(upcomingDate)}</span>
              </div>
            ` : ''}
          </div>
        </td>
        <td class="p-3 text-center text-xs font-semibold text-slate-200">
          ${currency}${fee}
        </td>
        ${monthCells}
        <td class="p-3 text-right pr-4">
          <div class="flex items-center justify-end gap-1">
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition btn-edit-user cursor-pointer" 
              data-id="${r._id}" 
              title="Edit User"
            >
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-700 transition btn-delete-user cursor-pointer" 
              data-id="${r._id}" 
              title="Delete Record"
            >
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Row Renderer 2: Exness Free VPS Table
function renderFreeRows(records) {
  recordsTableBody.innerHTML = records.map(r => {
    const isSelected = state.selectedIds.has(r._id);
    const startDate = r.firstPaymentDate || 'N/A';

    return `
      <tr class="hover:bg-slate-700/40 transition-colors group ${isSelected ? 'bg-indigo-950/20' : ''}" data-row-id="${r._id}">
        <td class="p-3 text-center">
          <input 
            type="checkbox" 
            class="row-checkbox rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer" 
            data-id="${r._id}"
            ${isSelected ? 'checked' : ''}
          >
        </td>
        <td class="p-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-xs flex-shrink-0">
              <i data-lucide="gift" class="w-4 h-4"></i>
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-100 truncate flex items-center gap-2">
                <span>${escapeHtml(r.name || 'Unnamed')}</span>
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
                  Exness Free
                </span>
              </div>
              <div class="text-xs text-slate-400 font-mono truncate">
                ${escapeHtml(r.email)}
              </div>
            </div>
          </div>
        </td>
        <td class="p-3 text-xs text-slate-300 font-mono">
          ${r.accountNumber ? `
            <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-amber-300 font-bold">
              <i data-lucide="hash" class="w-3.5 h-3.5 text-amber-400"></i>
              <span>${escapeHtml(r.accountNumber)}</span>
            </div>
          ` : '<span class="text-slate-500 italic">Not set</span>'}
        </td>
        <td class="p-3 text-xs text-slate-300 font-mono">
          ${r.server ? `
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
              ${escapeHtml(r.server)}
            </span>
          ` : '<span class="text-slate-500 italic">Exness Server</span>'}
        </td>
        <td class="p-3 text-xs text-slate-400 font-mono">
          ${escapeHtml(startDate)}
        </td>
        <td class="p-3 text-xs text-slate-300">
          ${r.notes ? `<span class="italic text-slate-300">${escapeHtml(r.notes)}</span>` : '<span class="text-slate-500">-</span>'}
        </td>
        <td class="p-3 text-center">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Active
          </span>
        </td>
        <td class="p-3 text-right pr-4">
          <div class="flex items-center justify-end gap-1">
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition btn-edit-user cursor-pointer" 
              data-id="${r._id}" 
              title="Edit Client"
            >
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-700 transition btn-delete-user cursor-pointer" 
              data-id="${r._id}" 
              title="Delete Client"
            >
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Row Renderer 3: Unified All Accounts Table
function renderAllRows(records) {
  recordsTableBody.innerHTML = records.map(r => {
    const isSelected = state.selectedIds.has(r._id);
    const isFree = isFreeVps(r);
    const upcomingDate = getUpcomingDueDate(r);

    return `
      <tr class="hover:bg-slate-700/40 transition-colors group ${isSelected ? 'bg-indigo-950/20' : ''}" data-row-id="${r._id}">
        <td class="p-3 text-center">
          <input 
            type="checkbox" 
            class="row-checkbox rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer" 
            data-id="${r._id}"
            ${isSelected ? 'checked' : ''}
          >
        </td>
        <td class="p-3">
          ${isFree ? `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-700/60">
              <i data-lucide="gift" class="w-3.5 h-3.5 text-emerald-400"></i>
              <span>Free Exness</span>
            </span>
          ` : `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/60">
              <i data-lucide="credit-card" class="w-3.5 h-3.5 text-indigo-400"></i>
              <span>Paid VPS</span>
            </span>
          `}
        </td>
        <td class="p-3">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg ${isFree ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'} border font-bold flex items-center justify-center text-xs flex-shrink-0">
              ${(r.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-100 truncate">
                ${escapeHtml(r.name || 'Unnamed')}
              </div>
              <div class="text-xs text-slate-400 font-mono truncate">
                ${escapeHtml(r.email)}
              </div>
            </div>
          </div>
        </td>
        <td class="p-3 text-xs text-slate-300 font-mono">
          ${isFree ? `
            <div class="space-y-0.5">
              ${r.accountNumber ? `<div class="text-amber-300 font-bold">MT5/Account: ${escapeHtml(r.accountNumber)}</div>` : ''}
              ${r.server ? `<div class="text-slate-400 text-[11px]">${escapeHtml(r.server)}</div>` : ''}
            </div>
          ` : `
            <div class="space-y-0.5">
              <div>1st: ${escapeHtml(r.firstPaymentDate || 'N/A')}</div>
              ${upcomingDate ? `<div class="text-amber-300">Next Due: ${escapeHtml(upcomingDate)}</div>` : ''}
            </div>
          `}
        </td>
        <td class="p-3 text-center text-xs font-semibold">
          ${isFree ? '<span class="text-emerald-400 font-bold">Free ($0)</span>' : `<span class="text-slate-200">${r.currency || '$'}${r.monthlyFee || 5}/mo</span>`}
        </td>
        <td class="p-3 text-center">
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800/60">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            Active
          </span>
        </td>
        <td class="p-3 text-xs text-slate-300">
          ${r.notes ? `<span class="italic text-slate-300 truncate max-w-xs block">${escapeHtml(r.notes)}</span>` : '<span class="text-slate-500">-</span>'}
        </td>
        <td class="p-3 text-right pr-4">
          <div class="flex items-center justify-end gap-1">
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition btn-edit-user cursor-pointer" 
              data-id="${r._id}" 
              title="Edit User"
            >
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-700 transition btn-delete-user cursor-pointer" 
              data-id="${r._id}" 
              title="Delete Record"
            >
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function attachRowEvents() {
  // Row checkboxes
  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      const row = cb.closest('tr');
      if (row) row.classList.toggle('bg-indigo-950/20', cb.checked);
      updateBatchToolbar();
    });
  });

  // Status pills click (Paid view only)
  document.querySelectorAll('.status-pill').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = btn.dataset.id;
      const month = btn.dataset.month;
      const currentStatus = btn.dataset.status;

      if (e.altKey || e.shiftKey) {
        openPaymentDetailModal(id, month);
        return;
      }

      // Cycle status: unset -> paid -> due -> unset
      let nextStatus = 'paid';
      if (currentStatus === 'paid') nextStatus = 'due';
      else if (currentStatus === 'due') nextStatus = 'unset';
      else nextStatus = 'paid';

      await updateSinglePayment(id, month, nextStatus);
    });

    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      const month = btn.dataset.month;
      openPaymentDetailModal(id, month);
    });
  });

  // Edit User buttons
  document.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => {
      openEditUserModal(btn.dataset.id);
    });
  });

  // Delete User buttons
  document.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', () => {
      deleteUser(btn.dataset.id);
    });
  });
}

// Single payment update helper
async function updateSinglePayment(id, month, nextStatus) {
  const btn = document.querySelector(`.status-pill[data-id="${id}"][data-month="${month}"]`);
  if (btn) {
    btn.classList.add('opacity-50');
  }

  try {
    const res = await fetch(`/api/records/${id}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: state.selectedYear,
        month,
        status: nextStatus,
        paidDate: nextStatus === 'paid' ? new Date().toISOString().split('T')[0] : ''
      })
    });
    const data = await res.json();
    if (data.success) {
      const record = state.records.find(r => r._id === id);
      if (record) {
        if (!record.payments) record.payments = {};
        if (!record.payments[state.selectedYear]) record.payments[state.selectedYear] = {};
        record.payments[state.selectedYear][month] = data.payment;
        if (data.nextDueDate) record.nextDueDate = data.nextDueDate;
      }
      renderTable();
      loadStats();
      const statusText = nextStatus === 'paid' ? 'PAID' : (nextStatus === 'due' ? 'NEED TO PAY' : 'UNSET');
      showToast(`${record?.name || 'User'} ${month}: ${statusText}`, 'info');
    }
  } catch (err) {
    showToast('Failed to update status', 'error');
  } finally {
    if (btn) btn.classList.remove('opacity-50');
  }
}

// Payment detail modal
function openPaymentDetailModal(id, month) {
  const record = state.records.find(r => r._id === id);
  if (!record) return;

  state.activePaymentTarget = { id, month };
  paymentTargetUser.textContent = `${record.name} (${record.email})`;
  paymentTargetMonth.textContent = `${month} ${state.selectedYear}`;

  const currentPayment = record.payments?.[state.selectedYear]?.[month];
  let modalSelectedStatus = currentPayment?.status || 'paid';

  paymentDateInput.value = currentPayment?.paidDate || (modalSelectedStatus === 'paid' ? new Date().toISOString().split('T')[0] : '');
  paymentAmountInput.value = currentPayment?.amount !== undefined ? currentPayment.amount : (record.monthlyFee || 5);
  paymentNotesInput.value = currentPayment?.notes || '';

  const statusBtns = document.querySelectorAll('.payment-status-option');
  statusBtns.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.pstatus === modalSelectedStatus);
    btn.onclick = () => {
      statusBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      modalSelectedStatus = btn.dataset.pstatus;
      if (btn.dataset.pstatus === 'paid' && !paymentDateInput.value) {
        paymentDateInput.value = new Date().toISOString().split('T')[0];
      }
    };
  });

  paymentDetailModal.classList.remove('hidden');
}

document.getElementById('btnClosePaymentModal').addEventListener('click', () => {
  paymentDetailModal.classList.add('hidden');
});

document.getElementById('btnSavePaymentDetails').addEventListener('click', async () => {
  if (!state.activePaymentTarget) return;
  const { id, month } = state.activePaymentTarget;
  const selectedStatusBtn = document.querySelector('.payment-status-option.selected');
  const modalSelectedStatus = selectedStatusBtn ? selectedStatusBtn.dataset.pstatus : 'unset';

  const customAmount = paymentAmountInput.value ? Number(paymentAmountInput.value) : undefined;

  try {
    const res = await fetch(`/api/records/${id}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: state.selectedYear,
        month,
        status: modalSelectedStatus,
        paidDate: paymentDateInput.value,
        amount: modalSelectedStatus === 'paid' ? customAmount : undefined,
        notes: paymentNotesInput.value
      })
    });
    const data = await res.json();
    if (data.success) {
      paymentDetailModal.classList.add('hidden');
      showToast('Payment details updated', 'success');
      loadData();
    }
  } catch (err) {
    showToast('Failed to update details', 'error');
  }
});

// --- Add / Edit User Modal & Type Toggle ---
function setModalVpsType(type) {
  modalVpsTypeInput.value = type;
  if (type === 'free_exness') {
    toggleTypePaid.classList.remove('active');
    toggleTypeFree.classList.add('active');
    paidVpsSection.classList.add('hidden');
    freeVpsSection.classList.remove('hidden');
  } else {
    toggleTypePaid.classList.add('active');
    toggleTypeFree.classList.remove('active');
    paidVpsSection.classList.remove('hidden');
    freeVpsSection.classList.add('hidden');
  }
}

if (toggleTypePaid && toggleTypeFree) {
  toggleTypePaid.addEventListener('click', () => setModalVpsType('paid'));
  toggleTypeFree.addEventListener('click', () => setModalVpsType('free_exness'));
}

function openAddUserModal() {
  state.editingUserId = null;
  userModalTitle.innerHTML = `<i data-lucide="user-plus" class="w-5 h-5 text-indigo-400"></i><span>Add New VPS User</span>`;
  userIdInput.value = '';
  modalEmailInput.value = '';
  modalNameInput.value = '';
  modalFeeInput.value = '5';
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  modalDateInput.value = todayStr;
  if (modalNextDueDateInput) modalNextDueDateInput.value = calculateUpcomingFromDate(todayStr);
  if (modalFreeStartDateInput) modalFreeStartDateInput.value = todayStr;
  if (modalAccountNumberInput) modalAccountNumberInput.value = '';
  if (modalServerInput) modalServerInput.value = '';
  modalNotesInput.value = '';

  // Default type according to current view
  if (state.activeView === 'free') {
    setModalVpsType('free_exness');
  } else {
    setModalVpsType('paid');
  }

  userModal.classList.remove('hidden');
  lucide.createIcons();
  modalEmailInput.focus();
}

function openEditUserModal(id) {
  const record = state.records.find(r => r._id === id);
  if (!record) return;

  state.editingUserId = id;
  userModalTitle.innerHTML = `<i data-lucide="edit-3" class="w-5 h-5 text-indigo-400"></i><span>Edit VPS User</span>`;
  userIdInput.value = id;
  modalEmailInput.value = record.email || '';
  modalNameInput.value = record.name || '';
  modalFeeInput.value = record.monthlyFee !== undefined ? record.monthlyFee : 5;
  modalDateInput.value = record.firstPaymentDate || '';
  if (modalNextDueDateInput) {
    modalNextDueDateInput.value = record.nextDueDate || calculateUpcomingFromDate(record.firstPaymentDate) || '';
  }
  if (modalAccountNumberInput) modalAccountNumberInput.value = record.accountNumber || '';
  if (modalServerInput) modalServerInput.value = record.server || '';
  if (modalFreeStartDateInput) modalFreeStartDateInput.value = record.firstPaymentDate || '';
  modalNotesInput.value = record.notes || '';

  setModalVpsType(record.vpsType === 'free_exness' ? 'free_exness' : 'paid');

  userModal.classList.remove('hidden');
  lucide.createIcons();
  modalNameInput.focus();
}

if (modalDateInput) {
  modalDateInput.addEventListener('input', () => {
    if (modalNextDueDateInput && modalDateInput.value) {
      modalNextDueDateInput.value = calculateUpcomingFromDate(modalDateInput.value);
    }
  });
}

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const vpsType = modalVpsTypeInput.value;
  const isFree = vpsType === 'free_exness';

  const payload = {
    vpsType,
    email: modalEmailInput.value.trim(),
    name: modalNameInput.value.trim(),
    notes: modalNotesInput.value.trim()
  };

  if (isFree) {
    payload.monthlyFee = 0;
    payload.accountNumber = modalAccountNumberInput.value.trim();
    payload.server = modalServerInput.value.trim();
    payload.firstPaymentDate = modalFreeStartDateInput.value.trim();
  } else {
    payload.monthlyFee = Number(modalFeeInput.value);
    payload.firstPaymentDate = modalDateInput.value.trim();
    payload.nextDueDate = modalNextDueDateInput ? modalNextDueDateInput.value.trim() : undefined;
  }

  try {
    let url = '/api/records';
    let method = 'POST';

    if (state.editingUserId) {
      url = `/api/records/${state.editingUserId}`;
      method = 'PUT';
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      userModal.classList.add('hidden');
      showToast(state.editingUserId ? 'User updated successfully' : 'New VPS user added!', 'success');
      loadData();
    } else {
      showToast('Error: ' + data.message, 'error');
    }
  } catch (err) {
    showToast('Failed to save record: ' + err.message, 'error');
  }
});

async function deleteUser(id) {
  const record = state.records.find(r => r._id === id);
  const name = record ? record.name : 'this user';

  if (!confirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(`${name} has been deleted`, 'info');
      state.selectedIds.delete(id);
      loadData();
    }
  } catch (err) {
    showToast('Failed to delete user', 'error');
  }
}

// --- Reminders & Unpaid List ---
function openRemindersModal() {
  if (!unpaidListBox) return;

  const unpaid = state.records.filter(r => {
    if (isFreeVps(r)) return false;
    const status = r.payments?.[state.selectedYear]?.[state.activeMonth]?.status || 'unset';
    return status === 'due' || status === 'unset';
  });

  reminderCountBadge.textContent = `${unpaid.length} pending`;

  if (unpaid.length === 0) {
    unpaidListBox.innerHTML = `
      <div class="p-6 text-center text-slate-400">
        <i data-lucide="check-circle" class="w-8 h-8 text-emerald-400 mx-auto mb-2"></i>
        <p class="font-semibold text-emerald-400">All users paid for ${state.activeMonth}!</p>
      </div>
    `;
    reminderTextTemplate.value = `Everyone has paid for ${state.activeMonth} ${state.selectedYear}.`;
  } else {
    unpaidListBox.innerHTML = unpaid.map((u, i) => `
      <div class="py-2.5 flex items-center justify-between">
        <div>
          <span class="font-medium text-slate-200">${i + 1}. ${escapeHtml(u.name)}</span>
          <span class="text-slate-400 font-mono text-[11px] block">${escapeHtml(u.email)}</span>
        </div>
        <div class="text-right">
          <span class="text-rose-400 font-semibold">$${u.monthlyFee || 5}</span>
          <span class="text-[10px] text-slate-500 block">${u.firstPaymentDate || 'No date'}</span>
        </div>
      </div>
    `).join('');

    const namesList = unpaid.map(u => `• ${u.name} (${u.email}) - $${u.monthlyFee || 5}`).join('\n');
    reminderTextTemplate.value = `Dear Client,\nThis is a friendly reminder regarding your VPS monthly renewal fee for ${state.activeMonth} ${state.selectedYear}.\n\nPlease find your account details below:\n${namesList}\n\nKindly send the payment at your earliest convenience. Thank you!`;
  }

  lucide.createIcons();
  remindersModal.classList.remove('hidden');
}

document.getElementById('btnCopyReminderText').addEventListener('click', () => {
  reminderTextTemplate.select();
  navigator.clipboard.writeText(reminderTextTemplate.value);
  showToast('Copied reminder template to clipboard!', 'info');
});

// --- Import Modal ---
let selectedExcelFile = null;

function setupImportModal() {
  dropArea.addEventListener('click', () => excelFileInput.click());

  excelFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  });

  dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('border-indigo-500');
  });

  dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('border-indigo-500');
  });

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('border-indigo-500');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  });

  btnSubmitImport.addEventListener('click', async () => {
    if (!selectedExcelFile) return;

    btnSubmitImport.disabled = true;
    btnSubmitImport.textContent = 'Uploading & Syncing...';

    const formData = new FormData();
    formData.append('excelFile', selectedExcelFile);
    formData.append('year', state.selectedYear);

    try {
      const res = await fetch('/api/import-excel', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        importModal.classList.add('hidden');
        loadData();
      } else {
        showToast('Error: ' + data.message, 'error');
      }
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      btnSubmitImport.disabled = false;
      btnSubmitImport.textContent = 'Upload & Sync Records';
    }
  });
}

function handleSelectedFile(file) {
  selectedExcelFile = file;
  selectedFileName.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
  selectedFileName.classList.remove('hidden');
  btnSubmitImport.disabled = false;
}

// --- Batch Actions ---
function updateBatchToolbar() {
  const count = state.selectedIds.size;
  if (count > 0) {
    batchActionToolbar.classList.remove('hidden');
    batchActionToolbar.classList.add('flex');
    selectedCountLabel.textContent = `${count} selected`;
  } else {
    batchActionToolbar.classList.add('hidden');
    batchActionToolbar.classList.remove('flex');
  }

  const allVisibleCheckboxes = document.querySelectorAll('.row-checkbox');
  const masterCb = document.getElementById('selectAllCheckbox');
  if (masterCb) {
    masterCb.checked = allVisibleCheckboxes.length > 0 && Array.from(allVisibleCheckboxes).every(cb => cb.checked);
  }
}

document.getElementById('btnBatchPaid').addEventListener('click', () => {
  batchUpdateStatus('paid');
});

document.getElementById('btnBatchDue').addEventListener('click', () => {
  batchUpdateStatus('due');
});

async function batchUpdateStatus(status) {
  if (state.selectedIds.size === 0) return;
  const ids = Array.from(state.selectedIds);

  try {
    const res = await fetch('/api/records/batch-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids,
        year: state.selectedYear,
        month: state.activeMonth,
        status
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Marked ${data.count} records as ${status.toUpperCase()} for ${state.activeMonth}`, 'success');
      state.selectedIds.clear();
      loadData();
    }
  } catch (err) {
    showToast('Failed to perform batch update', 'error');
  }
}

// --- General Event Listeners ---
function bindEvents() {
  // Year selector
  yearSelect.addEventListener('change', () => {
    state.selectedYear = yearSelect.value;
    loadData();
  });

  // Export Excel with auth token
  const btnExport = document.getElementById('btnExportExcel');
  if (btnExport) {
    btnExport.addEventListener('click', (e) => {
      e.preventDefault();
      const token = getAuthToken();
      const url = `/api/export-excel?year=${state.selectedYear}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      window.location.href = url;
    });
  }

  // Search input
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.searchQuery = searchInput.value.trim();
      btnClearSearch.classList.toggle('hidden', !state.searchQuery);
      renderTable();
    }, 250);
  });

  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    btnClearSearch.classList.add('hidden');
    renderTable();
  });

  // Modal triggers
  document.getElementById('btnOpenAddModal').addEventListener('click', openAddUserModal);
  document.getElementById('btnCloseUserModal').addEventListener('click', () => userModal.classList.add('hidden'));
  document.getElementById('btnCancelUserModal').addEventListener('click', () => userModal.classList.add('hidden'));

  document.getElementById('btnOpenReminders').addEventListener('click', openRemindersModal);
  document.getElementById('btnCloseRemindersModal').addEventListener('click', () => remindersModal.classList.add('hidden'));

  document.getElementById('btnOpenImportModal').addEventListener('click', () => {
    selectedExcelFile = null;
    selectedFileName.classList.add('hidden');
    btnSubmitImport.disabled = true;
    importModal.classList.remove('hidden');
  });
  document.getElementById('btnCloseImportModal').addEventListener('click', () => importModal.classList.add('hidden'));

  setupImportModal();
}

// --- Toast Helper ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  
  const colors = {
    success: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    error: 'bg-rose-950 text-rose-300 border-rose-800',
    info: 'bg-indigo-950 text-indigo-300 border-indigo-800'
  };

  const icons = {
    success: '<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i>',
    error: '<i data-lucide="alert-triangle" class="w-4 h-4 text-rose-400"></i>',
    info: '<i data-lucide="info" class="w-4 h-4 text-indigo-400"></i>'
  };

  toast.className = `toast-item pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium shadow-xl backdrop-blur ${colors[type] || colors.info}`;
  toast.innerHTML = `
    ${icons[type] || icons.info}
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
