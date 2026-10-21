const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
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

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Use memory storage for uploads (works on Vercel and locally)
const upload = multer({ storage: multer.memoryStorage() });

// Global MongoDB Client
let mongoClient = null;
let db = null;
let lastConnectionError = null;

// Connect to MongoDB Atlas
async function connectToMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    lastConnectionError = 'MONGODB_URI environment variable is not set';
    console.warn('⚠️  MONGODB_URI not set.');
    return;
  }
  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await mongoClient.connect();
    await mongoClient.db('admin').command({ ping: 1 });
    db = mongoClient.db(DB_NAME);
    lastConnectionError = null;
    console.log('✅ Connected to MongoDB Atlas!');
  } catch (err) {
    lastConnectionError = err.message;
    console.error('❌ MongoDB connection failed:', err.message);
  }
}

// Helper — get the collection (throws if not connected)
function getCollection() {
  if (!db) throw new Error('Database not connected. Check MONGODB_URI and Atlas Network Access settings.');
  return db.collection(COLLECTION_NAME);
}

// Helper — parse an id string into ObjectId or keep as string
function parseId(id) {
  try { return new ObjectId(id); } catch { return id; }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// 1. Health & Connection Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    connected: !!db,
    database: db ? 'MongoDB Atlas (Connected)' : 'Disconnected',
    error: lastConnectionError || null,
    uriSet: !!process.env.MONGODB_URI
  });
});

// 2. Get all records with filters
app.get('/api/records', async (req, res) => {
  try {
    const col = getCollection();
    const year = req.query.year || new Date().getFullYear().toString();
    const search = (req.query.search || '').trim().toLowerCase();
    const month = req.query.month;
    const statusFilter = req.query.statusFilter;

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
app.post('/api/records', async (req, res) => {
  try {
    const col = getCollection();
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
app.put('/api/records/:id', async (req, res) => {
  try {
    const col = getCollection();
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
app.put('/api/records/:id/payment', async (req, res) => {
  try {
    const col = getCollection();
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

    res.json({ success: true, payment: newPaymentData });
  } catch (err) {
    console.error('Error updating payment:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Batch update payment status
app.post('/api/records/batch-payment', async (req, res) => {
  try {
    const col = getCollection();
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

    res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error('Error in batch update:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Delete record
app.delete('/api/records/:id', async (req, res) => {
  try {
    const col = getCollection();
    const { id } = req.params;
    await col.deleteOne({ _id: parseId(id) });
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Statistics & Summary
app.get('/api/stats', async (req, res) => {
  try {
    const col = getCollection();
    const year = req.query.year || new Date().getFullYear().toString();
    const currentMonthIndex = new Date().getMonth();
    const month = req.query.month || MONTHS[currentMonthIndex];

    const records = await col.find({}).toArray();

    let paidCount = 0, dueCount = 0, unsetCount = 0;
    let totalRevenuePaid = 0, totalRevenueDue = 0;
    const paidUsers = [], needToPayUsers = [];

    records.forEach(r => {
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

    res.json({ success: true, year, month, totalUsers: records.length, paidCount, dueCount, unsetCount, totalRevenuePaid, totalRevenueDue, currency: '$', needToPayUsers, paidUsers });
  } catch (err) {
    console.error('Error calculating stats:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 9. Export to Excel
app.get('/api/export-excel', async (req, res) => {
  try {
    const col = getCollection();
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
app.post('/api/import-excel', upload.single('excelFile'), async (req, res) => {
  try {
    const col = getCollection();
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
