// Frontend application logic for VPS Fee Tracker

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

// App State
const state = {
  records: [],
  selectedYear: '2026',
  activeMonth: 'October', // Default to October based on Excel data
  statusFilter: 'all',    // 'all' | 'due' | 'paid' | 'unset'
  searchQuery: '',
  selectedIds: new Set(),
  editingUserId: null,
  activePaymentTarget: null
};

// DOM Elements
const recordsTableBody = document.getElementById('recordsTableBody');
const yearSelect = document.getElementById('yearSelect');
const monthTabsContainer = document.getElementById('monthTabsContainer');
const searchInput = document.getElementById('searchInput');
const btnClearSearch = document.getElementById('btnClearSearch');
const selectAllCheckbox = document.getElementById('selectAllCheckbox');
const batchActionToolbar = document.getElementById('batchActionToolbar');
const selectedCountLabel = document.getElementById('selectedCountLabel');
const tableRecordCountSummary = document.getElementById('tableRecordCountSummary');
const dbStatusBadge = document.getElementById('dbStatusBadge');

// Stat Elements
const statTotalUsers = document.getElementById('statTotalUsers');
const statPaidCount = document.getElementById('statPaidCount');
const statPaidPercent = document.getElementById('statPaidPercent');
const statDueCount = document.getElementById('statDueCount');
const statUnsetCount = document.getElementById('statUnsetCount');
const statCollectedFee = document.getElementById('statCollectedFee');
const statPendingFee = document.getElementById('statPendingFee');

// Modal Elements
const userModal = document.getElementById('userModal');
const userModalTitle = document.getElementById('userModalTitle');
const userForm = document.getElementById('userForm');
const userIdInput = document.getElementById('userIdInput');
const modalEmailInput = document.getElementById('modalEmailInput');
const modalNameInput = document.getElementById('modalNameInput');
const modalFeeInput = document.getElementById('modalFeeInput');
const modalDateInput = document.getElementById('modalDateInput');
const modalNextDueDateInput = document.getElementById('modalNextDueDateInput');
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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  initMonthTabs();
  bindEvents();
  checkHealth();
  loadData();
});

function initMonthTabs() {
  monthTabsContainer.innerHTML = '';
  MONTHS.forEach(m => {
    const btn = document.createElement('button');
    btn.className = `month-btn ${m === state.activeMonth ? 'active' : ''}`;
    btn.dataset.month = m;
    btn.textContent = m.substring(0, 3);
    btn.title = m;
    btn.addEventListener('click', () => {
      setActiveMonth(m);
    });
    monthTabsContainer.appendChild(btn);
  });
}

function setActiveMonth(month) {
  state.activeMonth = month;
  document.querySelectorAll('.month-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.month === month);
  });
  document.querySelectorAll('.activeMonthLabel').forEach(el => {
    el.textContent = month;
  });
  updateActiveMonthColumnHighlight();
  loadStats();
  renderTable();
}

function updateActiveMonthColumnHighlight() {
  document.querySelectorAll('.month-col').forEach(th => {
    th.classList.toggle('active-month-col', th.dataset.month === state.activeMonth);
  });
}

// --- API Calls ---
async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.database.includes('Atlas')) {
      dbStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Atlas Connected`;
      dbStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-950 text-emerald-400 border border-emerald-800/60';
    } else {
      dbStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> Local Storage`;
      dbStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-950 text-amber-400 border border-amber-800/60';
    }
  } catch (e) {
    dbStatusBadge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span> Offline`;
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
      statTotalUsers.textContent = data.totalUsers;
      statPaidCount.textContent = data.paidCount;
      const pct = data.totalUsers > 0 ? Math.round((data.paidCount / data.totalUsers) * 100) : 0;
      statPaidPercent.textContent = `(${pct}%)`;
      statDueCount.textContent = data.dueCount;
      statUnsetCount.textContent = data.unsetCount;

      statCollectedFee.textContent = `${data.currency}${data.totalRevenuePaid} collected`;
      statPendingFee.textContent = `${data.currency}${data.totalRevenueDue} due`;
    }
  } catch (e) {
    console.error('Error fetching stats:', e);
  }
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
    const m = parts[1] - 1; // 0-indexed month
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

function getUpcomingDueDate(record) {
  if (record.nextDueDate && record.nextDueDate.trim()) {
    return record.nextDueDate.trim();
  }
  return calculateUpcomingFromDate(record.firstPaymentDate);
}

// --- Render Table ---
function renderTable() {
  let displayRecords = [...state.records];

  // Apply search query
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    displayRecords = displayRecords.filter(r => 
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.email && r.email.toLowerCase().includes(q)) ||
      (r.notes && r.notes.toLowerCase().includes(q))
    );
  }

  // Apply status filter for active month
  if (state.statusFilter !== 'all') {
    displayRecords = displayRecords.filter(r => {
      const p = r.payments?.[state.selectedYear]?.[state.activeMonth]?.status || 'unset';
      return p === state.statusFilter;
    });
  }

  tableRecordCountSummary.innerHTML = `Showing <strong>${displayRecords.length}</strong> of ${state.records.length} VPS records (Year ${state.selectedYear})`;

  if (displayRecords.length === 0) {
    recordsTableBody.innerHTML = `
      <tr>
        <td colspan="17" class="p-8 text-center text-slate-400">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-500"></i>
          <p class="font-medium text-slate-300">No VPS records found</p>
          <p class="text-xs text-slate-500 mt-1">Try clearing filters or add a new VPS user above.</p>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  recordsTableBody.innerHTML = displayRecords.map(r => {
    const isSelected = state.selectedIds.has(r._id);
    const fee = r.monthlyFee !== undefined ? r.monthlyFee : 5;
    const currency = r.currency || '$';
    const isUnlicensed = r.status === 'unlicensed' || (r.firstPaymentDate && r.firstPaymentDate.toLowerCase() === 'unlicenced');

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
      <tr class="hover:bg-slate-700/30 transition group ${isSelected ? 'bg-indigo-950/20' : ''}" data-row-id="${r._id}">
        <td class="p-3 text-center">
          <input 
            type="checkbox" 
            class="row-checkbox rounded bg-slate-800 border-slate-600 text-indigo-600 focus:ring-0 cursor-pointer" 
            data-id="${r._id}"
            ${isSelected ? 'checked' : ''}
          >
        </td>
        <td class="p-3">
          <div class="flex items-center gap-2">
            <div>
              <div class="flex items-center gap-2">
                <span class="font-semibold text-white">${escapeHtml(r.name)}</span>
                ${isUnlicensed ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-300 border border-amber-800">Unlicensed</span>' : ''}
              </div>
              <div class="text-xs text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                <span>${escapeHtml(r.email)}</span>
                <button class="text-slate-500 hover:text-slate-300 transition copy-email-btn" data-email="${escapeHtml(r.email)}" title="Copy Email">
                  <i data-lucide="copy" class="w-3 h-3"></i>
                </button>
              </div>
              ${r.notes ? `<div class="text-[11px] text-indigo-300/80 italic mt-0.5">${escapeHtml(r.notes)}</div>` : ''}
            </div>
          </div>
        </td>
        <td class="p-3 text-xs text-slate-300">
          <div class="space-y-1">
            <span class="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-[11px] inline-block">
              1st: ${escapeHtml(r.firstPaymentDate || 'None')}
            </span>
            ${getUpcomingDueDate(r) ? `
              <div class="flex items-center gap-1 text-[11px] text-amber-300 font-mono">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                <span>Next: ${escapeHtml(getUpcomingDueDate(r))}</span>
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
              class="p-1.5 rounded-md text-slate-400 hover:text-indigo-400 hover:bg-slate-700 transition btn-edit-user" 
              data-id="${r._id}" 
              title="Edit User"
            >
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button 
              class="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-700 transition btn-delete-user" 
              data-id="${r._id}" 
              data-name="${escapeHtml(r.name)}"
              title="Delete User"
            >
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
  bindTableInteractions();
  updateBatchToolbar();
}

function bindTableInteractions() {
  // Month status pill click
  document.querySelectorAll('.status-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = btn.dataset.id;
      const month = btn.dataset.month;
      const currentStatus = btn.dataset.status;

      // If Alt or Ctrl key is pressed, open details modal directly
      if (e.altKey || e.ctrlKey) {
        openPaymentDetailsModal(id, month);
        return;
      }

      // Cycle status: unset -> paid -> due -> unset
      let nextStatus = 'paid';
      if (currentStatus === 'paid') nextStatus = 'due';
      else if (currentStatus === 'due') nextStatus = 'unset';
      else nextStatus = 'paid';

      quickUpdatePaymentStatus(id, month, nextStatus);
    });

    // Right-click opens details modal
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      const month = btn.dataset.month;
      openPaymentDetailsModal(id, month);
    });
  });

  // Row selection checkboxes
  document.querySelectorAll('.row-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      updateBatchToolbar();
      const row = cb.closest('tr');
      if (row) row.classList.toggle('bg-indigo-950/20', cb.checked);
    });
  });

  // Copy email button
  document.querySelectorAll('.copy-email-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.email);
      showToast('Copied email to clipboard!', 'info');
    });
  });

  // Edit user button
  document.querySelectorAll('.btn-edit-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      openEditUserModal(id);
    });
  });

  // Delete user button
  document.querySelectorAll('.btn-delete-user').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      confirmDeleteUser(id, name);
    });
  });
}

// --- Quick Update Payment ---
async function quickUpdatePaymentStatus(id, month, nextStatus) {
  // Optimistic UI update
  const record = state.records.find(r => r._id === id);
  if (record) {
    if (!record.payments) record.payments = {};
    if (!record.payments[state.selectedYear]) record.payments[state.selectedYear] = {};
    record.payments[state.selectedYear][month] = {
      status: nextStatus,
      paidDate: nextStatus === 'paid' ? new Date().toISOString().split('T')[0] : ''
    };
    renderTable();
    loadStats();
  }

  try {
    const res = await fetch(`/api/records/${id}/payment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: state.selectedYear,
        month,
        status: nextStatus
      })
    });
    const data = await res.json();
    if (!data.success) {
      showToast('Error updating status: ' + data.message, 'error');
      loadData();
    } else {
      const statusText = nextStatus === 'paid' ? 'PAID' : (nextStatus === 'due' ? 'NEED TO PAY' : 'UNSET');
      showToast(`Updated ${month}: ${statusText}`, 'success');
    }
  } catch (err) {
    showToast('Failed to save payment status', 'error');
    loadData();
  }
}

// --- Payment Details Modal ---
let modalSelectedStatus = 'paid';

function openPaymentDetailsModal(id, month) {
  const record = state.records.find(r => r._id === id);
  if (!record) return;

  state.activePaymentTarget = { id, month };
  paymentTargetUser.textContent = `${record.name} (${record.email})`;
  paymentTargetMonth.textContent = `${month} ${state.selectedYear}`;

  const currentPayment = record.payments?.[state.selectedYear]?.[month];
  modalSelectedStatus = currentPayment?.status || 'paid';
  setModalPaymentStatusUI(modalSelectedStatus);

  paymentDateInput.value = currentPayment?.paidDate || (modalSelectedStatus === 'paid' ? new Date().toISOString().split('T')[0] : '');
  if (paymentAmountInput) {
    const fee = record.monthlyFee !== undefined ? record.monthlyFee : 5;
    paymentAmountInput.value = (currentPayment?.amount !== undefined && currentPayment?.amount !== null && !isNaN(Number(currentPayment.amount)) && Number(currentPayment.amount) > 0)
      ? currentPayment.amount
      : fee;
  }
  paymentNotesInput.value = currentPayment?.notes || '';

  paymentDetailModal.classList.remove('hidden');
}

function setModalPaymentStatusUI(status) {
  modalSelectedStatus = status;
  document.querySelectorAll('.pstatus-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.pstatus === status);
  });
}

document.querySelectorAll('.pstatus-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setModalPaymentStatusUI(btn.dataset.pstatus);
    if (btn.dataset.pstatus === 'paid' && !paymentDateInput.value) {
      paymentDateInput.value = new Date().toISOString().split('T')[0];
    }
  });
});

document.getElementById('btnClosePaymentModal').addEventListener('click', () => {
  paymentDetailModal.classList.add('hidden');
});

document.getElementById('btnSavePaymentDetails').addEventListener('click', async () => {
  if (!state.activePaymentTarget) return;
  const { id, month } = state.activePaymentTarget;

  try {
    const customAmount = paymentAmountInput && paymentAmountInput.value !== '' ? Number(paymentAmountInput.value) : undefined;
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

// --- Add / Edit User Modal ---
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
  if (modalNextDueDateInput) {
    modalNextDueDateInput.value = calculateUpcomingFromDate(todayStr);
  }
  modalNotesInput.value = '';
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
  modalNotesInput.value = record.notes || '';
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

  const payload = {
    email: modalEmailInput.value.trim(),
    name: modalNameInput.value.trim(),
    monthlyFee: Number(modalFeeInput.value),
    firstPaymentDate: modalDateInput.value.trim(),
    nextDueDate: modalNextDueDateInput ? modalNextDueDateInput.value.trim() : undefined,
    notes: modalNotesInput.value.trim()
  };

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

async function confirmDeleteUser(id, name) {
  if (confirm(`Are you sure you want to delete "${name}" from VPS fee records?`)) {
    try {
      const res = await fetch(`/api/records/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Record deleted.', 'info');
        state.selectedIds.delete(id);
        loadData();
      }
    } catch (err) {
      showToast('Failed to delete record', 'error');
    }
  }
}

// --- Reminders & Unpaid List ---
function openRemindersModal() {
  reminderMonthTitle.textContent = `${state.activeMonth} ${state.selectedYear}`;
  
  // Find unpaid records
  const unpaid = state.records.filter(r => {
    const status = r.payments?.[state.selectedYear]?.[state.activeMonth]?.status || 'unset';
    return status === 'due' || status === 'unset';
  });

  reminderCountBadge.textContent = `${unpaid.length} pending`;

  if (unpaid.length === 0) {
    unpaidListBox.innerHTML = `
      <div class="py-6 text-center text-slate-400">
        <i data-lucide="check-circle-2" class="w-8 h-8 text-emerald-400 mx-auto mb-1"></i>
        <p class="font-semibold text-emerald-400">All users paid for ${state.activeMonth}!</p>
      </div>
    `;
    reminderTextTemplate.value = `Everyone has paid for ${state.activeMonth} ${state.selectedYear}.`;
  } else {
    unpaidListBox.innerHTML = unpaid.map((u, i) => `
      <div class="py-2 flex items-center justify-between">
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
  selectAllCheckbox.checked = allVisibleCheckboxes.length > 0 && Array.from(allVisibleCheckboxes).every(cb => cb.checked);
}

selectAllCheckbox.addEventListener('change', () => {
  const isChecked = selectAllCheckbox.checked;
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
    document.getElementById('btnExportExcel').href = `/api/export-excel?year=${state.selectedYear}`;
    loadData();
  });

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

  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.statusFilter = tab.dataset.filter;
      renderTable();
    });
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
