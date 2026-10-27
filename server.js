const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const crypto = require('crypto');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const xlsx = require('xlsx');

// Load env credentials (local dev only — Vercel uses dashboard env vars)
dotenv.config({ path: path.join(__dirname, 'atlas-credentials.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = 'vps_fee_management';
const COLLECTION_NAME = 'vps_records';

// Admin authentication credentials
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'HussainIjaz';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Hussainijaz@123';
const AUTH_SECRET = process.env.AUTH_SECRET || 'vps-fee-auth-secret-hussain-2026-key';

// ─── Authentication Helpers & Middleware ───────────────────────────────────────
function generateAuthToken(username, rememberMe) {
  // 30 days if rememberMe, 24 hours otherwise
  const durationMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const expiry = Date.now() + durationMs;
  const payload = `${username}:${expiry}`;
  const signature = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return null;
    const [username, expiryStr, signature] = parts;
    const expiry = parseInt(expiryStr, 10);
    if (isNaN(expiry) || Date.now() > expiry) return null; // expired

    const payload = `${username}:${expiryStr}`;
    const expectedSig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
    
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    return { username, expiry };
  } catch (e) {
    return null;
  }
}

function requireAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-auth-token']) {
    token = req.headers['x-auth-token'];
  } else if (req.query && req.query.token) {
    token = req.query.token;
  }

  const user = verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required or session expired.' });
  }
  req.user = user;
  next();
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Use memory storage for uploads (works on Vercel and locally)
const upload = multer({ storage: multer.memoryStorage() });

// Global MongoDB Client — reused across warm Vercel invocations
let mongoClient = null;
let db = null;
let lastConnectionError = null;
let isConnecting = false;

// Connect to MongoDB Atlas (lazy, cached, safe for serverless)
async function connectToMongo() {
  if (db) return; // already connected
  if (isConnecting) {
    // Wait for the in-progress connection
    await new Promise(resolve => setTimeout(resolve, 100));
    if (db) return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    lastConnectionError = 'MONGODB_URI environment variable is not set';
    console.warn('⚠️  MONGODB_URI not set.');
    return;
  }

  isConnecting = true;
  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await mongoClient.connect();
    await mongoClient.db('admin').command({ ping: 1 });
    db = mongoClient.db(DB_NAME);
    lastConnectionError = null;
    console.log('✅ Connected to MongoDB Atlas!');
  } catch (err) {
    lastConnectionError = err.message;
    db = null;
    console.error('❌ MongoDB connection failed:', err.message);
  } finally {
    isConnecting = false;
  }
}

// Helper — ensures connection then returns the collection
async function getCollection() {
  if (!db) await connectToMongo();
  if (!db) throw new Error('Database not connected. Check MONGODB_URI and Atlas Network Access settings.');
  return db.collection(COLLECTION_NAME);
}

// Helper — parse an id string into ObjectId or keep as string
function parseId(id) {
  try { return new ObjectId(id); } catch { return id; }
}

/**
 * Given a year (string) and month name, return the due date string (YYYY-MM-DD)
 * for a user whose billing day is `dueDay`.
 * Clamps to the last day of the month if needed (e.g. dueDay=31 in February).
 */
function getDueDateForMonth(year, monthName, dueDay) {
  const monthIndex = MONTHS.indexOf(monthName);
  if (monthIndex === -1 || !dueDay) return null;
  const daysInMonth = new Date(Number(year), monthIndex + 1, 0).getDate();
  const day = Math.min(dueDay, daysInMonth);
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Dynamically computes the next upcoming unpaid due date for a user,
 * starting from their firstPaymentDate.
 */
function computeNextDueDate(record) {
  if (!record.firstPaymentDate || !record.firstPaymentDate.trim()) return record.nextDueDate || '';
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

/**
 * Scan all records:
 * 1. Keeps pre-join months strictly 'unset' (reverts if accidentally 'due')
 * 2. Auto-flips 'unset' months to 'due' only when today >= due date for that month
 * 3. Keeps nextDueDate in sync with payment history
 */
async function applyAutoDueStatuses(col, records) {
  const todayStr = getLocalDateString();
  const bulkOps = [];

  for (const record of records) {
    if (record.vpsType === 'free_exness' || record.monthlyFee === 0) continue;
    if (!record.payments) continue;

    let joinYear = null;
    let joinMonthIndex = null;
    if (record.firstPaymentDate && record.firstPaymentDate.includes('-')) {
      const parts = record.firstPaymentDate.trim().split('-');
      if (parts.length >= 2) {
        joinYear = parseInt(parts[0], 10);
        joinMonthIndex = parseInt(parts[1], 10) - 1;
      }
    }

    const dueDay = record.dueDay || (record.firstPaymentDate && record.firstPaymentDate.includes('-')
      ? parseInt(record.firstPaymentDate.trim().split('-')[2], 10) || 1
      : null);

    const setObj = {};

    for (const [yearStr, monthObj] of Object.entries(record.payments)) {
      if (typeof monthObj !== 'object') continue;
      const yearNum = parseInt(yearStr, 10);
      if (isNaN(yearNum)) continue;

      for (const [monthName, pData] of Object.entries(monthObj)) {
        const mIdx = MONTHS.indexOf(monthName);
        if (mIdx === -1) continue;

        // Is this month strictly before the join month?
        const isPreJoin = (joinYear !== null && joinMonthIndex !== null) &&
          (yearNum < joinYear || (yearNum === joinYear && mIdx < joinMonthIndex));

        if (isPreJoin) {
          // Pre-join months MUST be unset! If marked due, reset back to unset!
          if (pData?.status === 'due') {
            setObj[`payments.${yearStr}.${monthName}`] = { status: 'unset' };
          }
          continue; // Never auto-due pre-join months
        }

        // For months on/after join date:
        if (pData?.status === 'unset' && dueDay) {
          const dueDateStr = getDueDateForMonth(yearStr, monthName, dueDay);
          if (dueDateStr && todayStr >= dueDateStr) {
            setObj[`payments.${yearStr}.${monthName}`] = {
              status: 'due',
              dueDate: dueDateStr,
              amount: record.monthlyFee || 5,
              notes: `Auto-due on ${dueDateStr}`
            };
          }
        }
      }
    }

    // Sync nextDueDate
    const currentNextDue = computeNextDueDate(record);
    if (currentNextDue && currentNextDue !== record.nextDueDate) {
      setObj.nextDueDate = currentNextDue;
    }

    if (Object.keys(setObj).length > 0) {
      setObj.updatedAt = new Date();
      bulkOps.push({ updateOne: { filter: { _id: record._id }, update: { $set: setObj } } });
    }
  }

  if (bulkOps.length > 0) await col.bulkWrite(bulkOps);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// 0. Authentication Routes
app.post('/api/login', (req, res) => {
  try {
    const { username, password, rememberMe } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const cleanUser = String(username).trim();
    const cleanPass = String(password);

    const isValidUser = cleanUser.toLowerCase() === ADMIN_USERNAME.toLowerCase();
    const isValidPass = cleanPass === ADMIN_PASSWORD;

    if (!isValidUser || !isValidPass) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const token = generateAuthToken(ADMIN_USERNAME, !!rememberMe);
    res.json({
      success: true,
      token,
      username: ADMIN_USERNAME,
      rememberMe: !!rememberMe,
      expiresIn: rememberMe ? '30 days' : '24 hours'
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Internal server error during login.' });
  }
});

app.get('/api/verify-token', requireAuth, (req, res) => {
  res.json({ success: true, valid: true, username: req.user.username });
});

// 1. Health & Connection Status
app.get('/api/health', async (req, res) => {
  if (!db) await connectToMongo();
  res.json({
    status: 'ok',
    connected: !!db,
    database: db ? 'MongoDB Atlas (Connected)' : 'Disconnected',
    error: lastConnectionError || null,
    uriSet: !!process.env.MONGODB_URI
  });
});

// 2. Get all records with filters
app.get('/api/records', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const year = req.query.year || new Date().getFullYear().toString();
    const search = (req.query.search || '').trim().toLowerCase();
    const month = req.query.month;
    const statusFilter = req.query.statusFilter;

    // Fetch raw docs, auto-update overdue statuses, then re-fetch fresh
    const rawRecords = await col.find({}).toArray();
    await applyAutoDueStatuses(col, rawRecords);
    let records = await col.find({}).toArray();
    records = records.map(r => ({ ...r, _id: r._id.toString() }));

    // Text search on email, name, or notes
    if (search) {
      records = records.filter(r =>
        (r.email && r.email.toLowerCase().includes(search)) ||
        (r.name && r.name.toLowerCase().includes(search)) ||
        (r.notes && r.notes.toLowerCase().includes(search))
      );
    }

    // Filter by month payment status
    if (month && statusFilter && statusFilter !== 'all') {
      records = records.filter(r => {
        const userStatus = r.payments?.[year]?.[month]?.status || 'unset';
        if (statusFilter === 'paid') return userStatus === 'paid';
        if (statusFilter === 'due') return userStatus === 'due';
        if (statusFilter === 'unset') return userStatus === 'unset';
        return true;
      });
    }

    // Sort by name ascending
    records.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json({ success: true, year, count: records.length, records });
  } catch (err) {
    console.error('Error fetching records:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

function getLocalDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calculateCycleDates(initialDate) {
  let base;
  if (initialDate && typeof initialDate === 'string' && initialDate.includes('-')) {
    const parts = initialDate.split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      base = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      base = new Date();
    }
  } else if (initialDate) {
    base = new Date(initialDate);
  } else {
    base = new Date();
  }
  if (isNaN(base.getTime())) base = new Date();

  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();

  const nextMonthYear = m === 11 ? y + 1 : y;
  const nextMonthIndex = m === 11 ? 0 : m + 1;
  const daysInNextMonth = new Date(nextMonthYear, nextMonthIndex + 1, 0).getDate();
  const targetDay = Math.min(d, daysInNextMonth);
  const nextMonthDate = new Date(nextMonthYear, nextMonthIndex, targetDay);

  const curDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const nextDateStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-${String(nextMonthDate.getDate()).padStart(2, '0')}`;

  return {
    currentDate: curDateStr,
    currentMonth: MONTHS[m],
    currentYear: y.toString(),
    nextDate: nextDateStr,
    nextMonth: MONTHS[nextMonthDate.getMonth()],
    nextYear: nextMonthDate.getFullYear().toString(),
    dueDay: d
  };
}

// 3. Create a new record
app.post('/api/records', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const { email, name, monthlyFee, currency, firstPaymentDate, notes, status } = req.body;

    if (!email || !name) {
      return res.status(400).json({ success: false, message: 'Both Email and Name are required.' });
    }

    const feeAmount = Number(monthlyFee) >= 0 ? Number(monthlyFee) : 5;
    const todayStr = getLocalDateString();
    const initialDate = (firstPaymentDate || todayStr).trim();
    const cycle = calculateCycleDates(initialDate);

    const defaultPayments = {};
    for (const m of MONTHS) defaultPayments[m] = { status: 'unset' };

    defaultPayments[cycle.currentMonth] = {
      status: 'paid',
      paidDate: cycle.currentDate,
      amount: feeAmount,
      notes: 'Initial activation'
    };

    const paymentsObj = { [cycle.currentYear]: defaultPayments };

    if (cycle.nextYear === cycle.currentYear) {
      defaultPayments[cycle.nextMonth] = {
        status: 'due',
        dueDate: cycle.nextDate,
        amount: feeAmount,
        notes: `Due on next same date: ${cycle.nextDate}`
      };
    } else {
      paymentsObj[cycle.nextYear] = {};
      for (const m of MONTHS) paymentsObj[cycle.nextYear][m] = { status: 'unset' };
      paymentsObj[cycle.nextYear][cycle.nextMonth] = {
        status: 'due',
        dueDate: cycle.nextDate,
        amount: feeAmount,
        notes: `Due on next same date: ${cycle.nextDate}`
      };
    }

    const newRecord = {
      email: email.trim(),
      name: name.trim(),
      monthlyFee: feeAmount,
      currency: currency || '$',
      firstPaymentDate: initialDate,
      nextDueDate: cycle.nextDate,
      dueDay: cycle.dueDay,
      notes: (notes || '').trim(),
      status: status || 'active',
      payments: paymentsObj,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await col.insertOne(newRecord);
    newRecord._id = result.insertedId.toString();

    res.status(201).json({ success: true, record: newRecord });
  } catch (err) {
    console.error('Error creating record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Update record details
app.put('/api/records/:id', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const { id } = req.params;
    const { email, name, monthlyFee, currency, firstPaymentDate, nextDueDate, notes, status } = req.body;

    const updateFields = {
      ...(email !== undefined && { email: email.trim() }),
      ...(name !== undefined && { name: name.trim() }),
      ...(monthlyFee !== undefined && { monthlyFee: Number(monthlyFee) }),
      ...(currency !== undefined && { currency }),
      ...(notes !== undefined && { notes: notes.trim() }),
      ...(status !== undefined && { status }),
      updatedAt: new Date()
    };

    if (firstPaymentDate !== undefined) {
      const trimmed = firstPaymentDate.trim();
      updateFields.firstPaymentDate = trimmed;
      if (trimmed && !trimmed.toLowerCase().includes('unlicenc') && !trimmed.toLowerCase().includes('none')) {
        const cycle = calculateCycleDates(trimmed);
        updateFields.nextDueDate = (nextDueDate && nextDueDate.trim()) ? nextDueDate.trim() : cycle.nextDate;
        updateFields.dueDay = cycle.dueDay;
      } else {
        updateFields.nextDueDate = '';
        updateFields.dueDay = null;
      }
    } else if (nextDueDate !== undefined) {
      updateFields.nextDueDate = nextDueDate.trim();
    }

    await col.updateOne({ _id: parseId(id) }, { $set: updateFields });

    const updated = await col.findOne({ _id: parseId(id) });
    res.json({ success: true, message: 'Record updated successfully.', record: { ...updated, _id: updated._id.toString() } });
  } catch (err) {
    console.error('Error updating record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Update payment for a specific month
app.put('/api/records/:id/payment', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const { id } = req.params;
    const { year, month, status, paidDate, amount, notes } = req.body;

    if (!year || !month) {
      return res.status(400).json({ success: false, message: 'Year and Month are required.' });
    }

    // Fetch the record to get the monthly fee
    const record = await col.findOne({ _id: parseId(id) });
    const userFee = record && Number(record.monthlyFee) >= 0 ? Number(record.monthlyFee) : 5;

    const validAmount = (amount !== undefined && amount !== null && amount !== '' && !isNaN(Number(amount)) && Number(amount) > 0)
      ? Number(amount)
      : (status === 'paid' ? userFee : undefined);

    const newPaymentData = {
      status: status || 'unset',
      paidDate: paidDate || (status === 'paid' ? new Date().toISOString().split('T')[0] : ''),
      amount: validAmount,
      notes: notes || ''
    };

    await col.updateOne(
      { _id: parseId(id) },
      { $set: { [`payments.${year}.${month}`]: newPaymentData, updatedAt: new Date() } }
    );

    // Recompute nextDueDate and update it
    const updatedRecord = await col.findOne({ _id: parseId(id) });
    let computedNextDueDate = '';
    if (updatedRecord) {
      computedNextDueDate = computeNextDueDate(updatedRecord);
      if (computedNextDueDate && computedNextDueDate !== updatedRecord.nextDueDate) {
        await col.updateOne({ _id: updatedRecord._id }, { $set: { nextDueDate: computedNextDueDate } });
      }
    }

    res.json({ success: true, payment: newPaymentData });
  } catch (err) {
    console.error('Error updating payment:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Batch update payment status
app.post('/api/records/batch-payment', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const { ids, year, month, status } = req.body;
    if (!Array.isArray(ids) || !year || !month || !status) {
      return res.status(400).json({ success: false, message: 'Invalid batch parameters.' });
    }

    const objectIds = ids.map(parseId);
    const records = await col.find({ _id: { $in: objectIds } }).toArray();
    const feeMap = new Map(records.map(r => [r._id.toString(), Number(r.monthlyFee) >= 0 ? Number(r.monthlyFee) : 5]));

    // Update each record individually to use correct fee
    await Promise.all(ids.map(id => {
      const fee = feeMap.get(id) || 5;
      return col.updateOne(
        { _id: parseId(id) },
        {
          $set: {
            [`payments.${year}.${month}`]: {
              status,
              paidDate: status === 'paid' ? new Date().toISOString().split('T')[0] : '',
              amount: status === 'paid' ? fee : undefined,
              notes: 'Batch update'
            },
            updatedAt: new Date()
          }
        }
      );
    }));

    // Recompute nextDueDate for all affected records
    const updatedRecords = await col.find({ _id: { $in: objectIds } }).toArray();
    await Promise.all(updatedRecords.map(r => {
      const newNextDueDate = computeNextDueDate(r);
      if (newNextDueDate && newNextDueDate !== r.nextDueDate) {
        return col.updateOne({ _id: r._id }, { $set: { nextDueDate: newNextDueDate, updatedAt: new Date() } });
      }
      return Promise.resolve();
    }));

    res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error('Error in batch update:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Delete record
app.delete('/api/records/:id', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const { id } = req.params;
    await col.deleteOne({ _id: parseId(id) });
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Statistics & Summary
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const year = req.query.year || new Date().getFullYear().toString();
    const currentMonthIndex = new Date().getMonth();
    const month = req.query.month || MONTHS[currentMonthIndex];

    const records = await col.find({}).toArray();

    let totalAllAccounts = records.length;
    let totalPaidAccounts = 0;
    let totalFreeAccounts = 0;

    let paidCount = 0, dueCount = 0, unsetCount = 0;
    let totalRevenuePaid = 0, totalRevenueDue = 0;
    const paidUsers = [], needToPayUsers = [];

    records.forEach(r => {
      const isFree = r.vpsType === 'free_exness' || r.monthlyFee === 0;
      if (isFree) {
        totalFreeAccounts++;
        return; // Exclude from paid monthly fee tracking
      }

      totalPaidAccounts++;
      const fee = Number(r.monthlyFee) >= 0 ? Number(r.monthlyFee) : 5;
      const payment = r.payments?.[year]?.[month];
      const status = payment?.status || 'unset';

      if (status === 'paid') {
        paidCount++;
        const paidAmount = (payment?.amount !== undefined && !isNaN(Number(payment.amount)) && Number(payment.amount) > 0)
          ? Number(payment.amount) : fee;
        totalRevenuePaid += paidAmount;
        paidUsers.push({ id: r._id.toString(), name: r.name, email: r.email, paidDate: payment?.paidDate || 'Paid', fee: paidAmount, currency: r.currency || '$' });
      } else if (status === 'due') {
        dueCount++;
        totalRevenueDue += fee;
        needToPayUsers.push({ id: r._id.toString(), name: r.name, email: r.email, status: 'due', fee, currency: r.currency || '$', firstPaymentDate: r.firstPaymentDate });
      } else {
        unsetCount++;
      }
    });

    res.json({
      success: true,
      year,
      month,
      totalUsers: totalAllAccounts,
      totalPaidAccounts,
      totalFreeAccounts,
      paidCount,
      dueCount,
      unsetCount,
      totalRevenuePaid,
      totalRevenueDue,
      currency: '$',
      needToPayUsers,
      paidUsers
    });
  } catch (err) {
    console.error('Error calculating stats:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9. Export to Excel
app.get('/api/export-excel', requireAuth, async (req, res) => {
  try {
    const col = await getCollection();
    const year = req.query.year || new Date().getFullYear().toString();
    const records = await col.find({}).toArray();

    const excelRows = records.map(r => {
      const row = { 'Email': r.email, 'Name': r.name };
      MONTHS.forEach(m => {
        const pStatus = r.payments?.[year]?.[m]?.status;
        row[m] = pStatus === 'paid' ? true : pStatus === 'due' ? false : null;
      });
      row['Date of 1st payment'] = r.firstPaymentDate || null;
      return row;
    });

    const worksheet = xlsx.utils.json_to_sheet(excelRows, {
      header: ['Email', 'Name', ...MONTHS, 'Date of 1st payment']
    });
    worksheet['!cols'] = [{ wch: 34 }, { wch: 18 }, ...MONTHS.map(() => ({ wch: 12 })), { wch: 20 }];

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'VPS Fees ' + year);
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="VPS_Fee_Record_${year}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting to Excel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 10. Import from uploaded Excel
app.post('/api/import-excel', requireAuth, upload.single('excelFile'), async (req, res) => {
  try {
    const col = await getCollection();
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No Excel file uploaded.' });
    }

    const year = req.body.year || new Date().getFullYear().toString();
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    const existingRecords = await col.find({}).toArray();
    const existingMap = new Map(
      existingRecords.map(r => [`${r.email.toLowerCase()}__${r.name.toLowerCase()}`, r])
    );

    let newCount = 0, updatedCount = 0;

    for (const row of rows) {
      const email = (row['Email'] || '').toString().trim();
      const name = (row['Name'] || '').toString().trim();
      if (!email && !name) continue;

      let firstPaymentDate = '';
      const rawDate = row['Date of 1st payment'];
      if (rawDate !== null && rawDate !== undefined) {
        if (typeof rawDate === 'number') {
          try {
            const parsed = xlsx.SSF.parse_date_code(rawDate);
            firstPaymentDate = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
          } catch { firstPaymentDate = String(rawDate); }
        } else {
          firstPaymentDate = String(rawDate).trim();
        }
      }

      const yearPayments = {};
      MONTHS.forEach(m => {
        const val = row[m];
        if (val === true || String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'paid') {
          yearPayments[m] = { status: 'paid' };
        } else if (val === false || String(val).toLowerCase() === 'false' || String(val).toLowerCase() === 'unpaid') {
          yearPayments[m] = { status: 'due' };
        } else {
          yearPayments[m] = { status: 'unset' };
        }
      });

      let cycle = null;
      if (firstPaymentDate && !firstPaymentDate.toLowerCase().includes('unlicenc') && !firstPaymentDate.toLowerCase().includes('none')) {
        cycle = calculateCycleDates(firstPaymentDate);
      }

      const key = `${email.toLowerCase()}__${name.toLowerCase()}`;
      const existing = existingMap.get(key);

      if (existing) {
        const updatedPayments = { ...(existing.payments || {}) };
        updatedPayments[year] = { ...(updatedPayments[year] || {}), ...yearPayments };
        await col.updateOne(
          { _id: existing._id },
          { $set: { firstPaymentDate: firstPaymentDate || existing.firstPaymentDate, nextDueDate: cycle ? cycle.nextDate : (existing.nextDueDate || ''), dueDay: cycle ? cycle.dueDay : (existing.dueDay || null), payments: updatedPayments, updatedAt: new Date() } }
        );
        updatedCount++;
      } else {
        const newRecord = {
          email, name: name || 'Unnamed', monthlyFee: 5, currency: '$',
          firstPaymentDate, nextDueDate: cycle ? cycle.nextDate : '',
          dueDay: cycle ? cycle.dueDay : null, notes: '', status: 'active',
          payments: { [year]: yearPayments }, createdAt: new Date(), updatedAt: new Date()
        };
        await col.insertOne(newRecord);
        newCount++;
      }
    }

    res.json({ success: true, message: `Import completed: ${newCount} added, ${updatedCount} updated.` });
  } catch (err) {
    console.error('Error importing Excel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start server
async function startServer() {
  await connectToMongo();
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(` VPS Fee Management Website is running!`);
      console.log(` URL: http://localhost:${PORT}`);
      console.log(` Database: ${db ? 'MongoDB Atlas' : 'DISCONNECTED'}`);
      console.log(`===============================================`);
    });
  }
}

startServer();

// Export for Vercel serverless
module.exports = app;







