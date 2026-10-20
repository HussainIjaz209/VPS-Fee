const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');
const multer = require('multer');
const xlsx = require('xlsx');

// Load env credentials
dotenv.config({ path: path.join(__dirname, 'atlas-credentials.env') });
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = 'vps_fee_management';
const COLLECTION_NAME = 'vps_records';
const LOCAL_BACKUP_PATH = path.join(__dirname, 'data', 'local-backup.json');
const EXCEL_FILE_PATH = path.join(__dirname, 'VPS Fee Record.xlsx');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for Excel file uploads
const upload = multer({ dest: path.join(__dirname, 'data', 'uploads') });
if (!fs.existsSync(path.join(__dirname, 'data', 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'data', 'uploads'), { recursive: true });
}

// Global MongoDB Client
let mongoClient = null;
let isConnectedToAtlas = false;

// Fallback local memory store if Atlas connection is unavailable
let localStore = [];

function loadLocalBackup() {
  try {
    if (fs.existsSync(LOCAL_BACKUP_PATH)) {
      const data = fs.readFileSync(LOCAL_BACKUP_PATH, 'utf8');
      localStore = JSON.parse(data);
      console.log(`Loaded ${localStore.length} records from local backup.`);
    }
  } catch (e) {
    console.error('Error reading local backup:', e.message);
  }
}

function saveLocalBackup(records) {
  try {
    fs.writeFileSync(LOCAL_BACKUP_PATH, JSON.stringify(records, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving local backup:', e.message);
  }
}

loadLocalBackup();

// Connect to MongoDB Atlas
async function connectToMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('⚠️ MONGODB_URI not found. Using local JSON store fallback.');
    return;
  }
  try {
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    isConnectedToAtlas = true;
    console.log(' Successfully connected to MongoDB Atlas!');

    // Sync from Atlas to local backup
    const db = mongoClient.db(DB_NAME);
    const docs = await db.collection(COLLECTION_NAME).find({}).toArray();
    if (docs.length > 0) {
      localStore = docs.map(d => ({ ...d, _id: d._id.toString() }));
      saveLocalBackup(localStore);
    } else if (localStore.length > 0) {
      // If Atlas is empty but localStore has data, seed Atlas
      console.log(`Syncing ${localStore.length} local records to MongoDB Atlas...`);
      const toInsert = localStore.map(d => {
        const item = { ...d };
        delete item._id;
        return item;
      });
      await db.collection(COLLECTION_NAME).insertMany(toInsert);
    }
  } catch (err) {
    isConnectedToAtlas = false;
    console.warn('⚠️ Could not connect to MongoDB Atlas. Operating in offline/local mode:', err.message);
  }
}

// Helper to get collection or fallback
async function getAllRecords() {
  if (isConnectedToAtlas && mongoClient) {
    try {
      const db = mongoClient.db(DB_NAME);
      const docs = await db.collection(COLLECTION_NAME).find({}).toArray();
      localStore = docs.map(d => ({ ...d, _id: d._id.toString() }));
      saveLocalBackup(localStore);
      return localStore;
    } catch (e) {
      console.warn('Failed to query Atlas, falling back to local memory:', e.message);
      return localStore;
    }
  }
  return localStore;
}

// Routes

// 1. Health & Connection Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: isConnectedToAtlas ? 'MongoDB Atlas (Connected)' : 'Local File Storage (Active)',
    totalRecords: localStore.length
  });
});

// 2. Get all records with filters
app.get('/api/records', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const search = (req.query.search || '').trim().toLowerCase();
    const month = req.query.month; // Optional month filter
    const statusFilter = req.query.statusFilter; // 'all', 'paid', 'due', 'unset'

    let records = await getAllRecords();

    // Text search on email or name
    if (search) {
      records = records.filter(r => 
        (r.email && r.email.toLowerCase().includes(search)) ||
        (r.name && r.name.toLowerCase().includes(search)) ||
        (r.notes && r.notes.toLowerCase().includes(search))
      );
    }

    // Filter by month status (who paid / who need to pay)
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

    res.json({
      success: true,
      year,
      count: records.length,
      records
    });
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
  const m = base.getMonth(); // 0-11
  const d = base.getDate();

  // Safely calculate same day next month without month overflow
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

// 3. Create a new record (No verification needed, user enters email and name)
app.post('/api/records', async (req, res) => {
  try {
    const { email, name, monthlyFee, currency, firstPaymentDate, notes, status } = req.body;

    if (!email || !name) {
      return res.status(400).json({ success: false, message: 'Both Email and Name are required.' });
    }

    const feeAmount = Number(monthlyFee) >= 0 ? Number(monthlyFee) : 5; // Default 5 dollars
    const todayStr = getLocalDateString();
    const initialDate = (firstPaymentDate || todayStr).trim();
    const cycle = calculateCycleDates(initialDate);

    // Initialize current year payments
    const defaultPayments = {};
    for (const m of MONTHS) {
      defaultPayments[m] = { status: 'unset' };
    }

    // Mark current month as PAID on current date
    defaultPayments[cycle.currentMonth] = {
      status: 'paid',
      paidDate: cycle.currentDate,
      amount: feeAmount,
      notes: 'Initial activation'
    };

    const paymentsObj = {
      [cycle.currentYear]: defaultPayments
    };

    // Mark next same date as NEED TO PAY (Due)
    if (cycle.nextYear === cycle.currentYear) {
      defaultPayments[cycle.nextMonth] = {
        status: 'due',
        dueDate: cycle.nextDate,
        amount: feeAmount,
        notes: `Due on next same date: ${cycle.nextDate}`
      };
    } else {
      // Rollover into next year
      paymentsObj[cycle.nextYear] = {};
      for (const m of MONTHS) {
        paymentsObj[cycle.nextYear][m] = { status: 'unset' };
      }
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

    if (isConnectedToAtlas && mongoClient) {
      const db = mongoClient.db(DB_NAME);
      const result = await db.collection(COLLECTION_NAME).insertOne(newRecord);
      newRecord._id = result.insertedId.toString();
    } else {
      newRecord._id = 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    }

    localStore.push(newRecord);
    saveLocalBackup(localStore);

    res.status(201).json({ success: true, record: newRecord });
  } catch (err) {
    console.error('Error creating record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Update record details
app.put('/api/records/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, monthlyFee, currency, firstPaymentDate, nextDueDate, notes, status } = req.body;

    const updateFields = {
      email: email ? email.trim() : undefined,
      name: name ? name.trim() : undefined,
      monthlyFee: monthlyFee !== undefined ? Number(monthlyFee) : undefined,
      currency: currency !== undefined ? currency : undefined,
      notes: notes !== undefined ? notes.trim() : undefined,
      status: status !== undefined ? status : undefined,
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

    // Remove undefined values
    Object.keys(updateFields).forEach(k => updateFields[k] === undefined && delete updateFields[k]);

    if (isConnectedToAtlas && mongoClient) {
      const db = mongoClient.db(DB_NAME);
      let queryId;
      try {
        queryId = new ObjectId(id);
      } catch (e) {
        queryId = id;
      }
      await db.collection(COLLECTION_NAME).updateOne(
        { _id: queryId },
        { $set: updateFields }
      );
    }

    // Update local store
    const idx = localStore.findIndex(r => r._id === id || String(r._id) === id);
    if (idx !== -1) {
      localStore[idx] = { ...localStore[idx], ...updateFields };
      saveLocalBackup(localStore);
    }

    res.json({ success: true, message: 'Record updated successfully.', record: localStore[idx] });
  } catch (err) {
    console.error('Error updating record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Update / Toggle Payment for a specific month
app.put('/api/records/:id/payment', async (req, res) => {
  try {
    const { id } = req.params;
    const { year, month, status, paidDate, amount, notes } = req.body;

    if (!year || !month) {
      return res.status(400).json({ success: false, message: 'Year and Month are required.' });
    }

    const idx = localStore.findIndex(r => r._id === id || String(r._id) === id);
    const userFee = (idx !== -1 && Number(localStore[idx].monthlyFee) >= 0) ? Number(localStore[idx].monthlyFee) : 5;

    // Default amount to user monthly fee if marked paid and no specific amount given
    const validAmount = (amount !== undefined && amount !== null && amount !== '' && !isNaN(Number(amount)) && Number(amount) > 0)
      ? Number(amount)
      : (status === 'paid' ? userFee : undefined);

    const newPaymentData = {
      status: status || 'unset',
      paidDate: paidDate || (status === 'paid' ? new Date().toISOString().split('T')[0] : ''),
      amount: validAmount,
      notes: notes || ''
    };

    const paymentPath = `payments.${year}.${month}`;

    if (isConnectedToAtlas && mongoClient) {
      const db = mongoClient.db(DB_NAME);
      let queryId;
      try {
        queryId = new ObjectId(id);
      } catch (e) {
        queryId = id;
      }
      await db.collection(COLLECTION_NAME).updateOne(
        { _id: queryId },
        {
          $set: {
            [paymentPath]: newPaymentData,
            updatedAt: new Date()
          }
        }
      );
    }

    // Update local store
    if (idx !== -1) {
      if (!localStore[idx].payments) localStore[idx].payments = {};
      if (!localStore[idx].payments[year]) localStore[idx].payments[year] = {};
      localStore[idx].payments[year][month] = newPaymentData;
      localStore[idx].updatedAt = new Date();
      saveLocalBackup(localStore);
    }

    res.json({ success: true, payment: newPaymentData });
  } catch (err) {
    console.error('Error updating payment:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Batch update payment status
app.post('/api/records/batch-payment', async (req, res) => {
  try {
    const { ids, year, month, status } = req.body;
    if (!Array.isArray(ids) || !year || !month || !status) {
      return res.status(400).json({ success: false, message: 'Invalid batch parameters.' });
    }

    if (isConnectedToAtlas && mongoClient) {
      const db = mongoClient.db(DB_NAME);
      const objectIds = ids.map(id => {
        try { return new ObjectId(id); } catch (e) { return id; }
      });
      await db.collection(COLLECTION_NAME).updateMany(
        { _id: { $in: objectIds } },
        {
          $set: {
            [`payments.${year}.${month}`]: {
              status,
              paidDate: status === 'paid' ? new Date().toISOString().split('T')[0] : '',
              amount: status === 'paid' ? 5 : undefined,
              notes: 'Batch update'
            },
            updatedAt: new Date()
          }
        }
      );
    }

    // Update local store
    localStore.forEach(r => {
      if (ids.includes(String(r._id))) {
        const fee = Number(r.monthlyFee) >= 0 ? Number(r.monthlyFee) : 5;
        const paymentData = {
          status,
          paidDate: status === 'paid' ? new Date().toISOString().split('T')[0] : '',
          amount: status === 'paid' ? fee : undefined,
          notes: 'Batch update'
        };
        if (!r.payments) r.payments = {};
        if (!r.payments[year]) r.payments[year] = {};
        r.payments[year][month] = paymentData;
        r.updatedAt = new Date();
      }
    });
    saveLocalBackup(localStore);

    res.json({ success: true, count: ids.length });
  } catch (err) {
    console.error('Error in batch update:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Delete record
app.delete('/api/records/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (isConnectedToAtlas && mongoClient) {
      const db = mongoClient.db(DB_NAME);
      let queryId;
      try { queryId = new ObjectId(id); } catch (e) { queryId = id; }
      await db.collection(COLLECTION_NAME).deleteOne({ _id: queryId });
    }

    localStore = localStore.filter(r => r._id !== id && String(r._id) !== id);
    saveLocalBackup(localStore);

    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error('Error deleting record:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 8. Statistics & Summary (Who paid & Who need to pay)
app.get('/api/stats', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const currentMonthIndex = new Date().getMonth();
    const month = req.query.month || MONTHS[currentMonthIndex];

    const records = await getAllRecords();

    let paidCount = 0;
    let dueCount = 0;
    let unsetCount = 0;
    let totalRevenuePaid = 0;
    let totalRevenueDue = 0;

    const paidUsers = [];
    const needToPayUsers = [];

    records.forEach(r => {
      const fee = Number(r.monthlyFee) >= 0 ? Number(r.monthlyFee) : 5;
      const payment = r.payments?.[year]?.[month];
      const status = payment?.status || 'unset';

      if (status === 'paid') {
        paidCount++;
        const paidAmount = (payment?.amount !== undefined && payment?.amount !== null && !isNaN(Number(payment.amount)) && Number(payment.amount) > 0)
          ? Number(payment.amount)
          : fee;
        totalRevenuePaid += paidAmount;
        paidUsers.push({
          id: r._id,
          name: r.name,
          email: r.email,
          paidDate: payment?.paidDate || 'Paid',
          fee: paidAmount,
          currency: r.currency || '$'
        });
      } else if (status === 'due') {
        dueCount++;
        totalRevenueDue += fee;
        needToPayUsers.push({
          id: r._id,
          name: r.name,
          email: r.email,
          status: 'due',
          fee: fee,
          currency: r.currency || '$',
          firstPaymentDate: r.firstPaymentDate
        });
      } else {
        unsetCount++;
      }
    });

    res.json({
      success: true,
      year,
      month,
      totalUsers: records.length,
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

// 9. Export to Excel (Matches exact format of VPS Fee Record.xlsx)
app.get('/api/export-excel', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear().toString();
    const records = await getAllRecords();

    // Prepare rows
    const excelRows = records.map(r => {
      const row = {
        'Email': r.email,
        'Name': r.name
      };

      // Add each month
      MONTHS.forEach(m => {
        const pStatus = r.payments?.[year]?.[m]?.status;
        if (pStatus === 'paid') {
          row[m] = true;
        } else if (pStatus === 'due') {
          row[m] = false;
        } else {
          row[m] = null;
        }
      });

      row['Date of 1st payment'] = r.firstPaymentDate || null;
      return row;
    });

    const worksheet = xlsx.utils.json_to_sheet(excelRows, {
      header: ['Email', 'Name', ...MONTHS, 'Date of 1st payment']
    });

    // Auto width
    const colWidths = [
      { wch: 34 }, // Email
      { wch: 18 }, // Name
      ...MONTHS.map(() => ({ wch: 12 })),
      { wch: 20 }  // Date of 1st payment
    ];
    worksheet['!cols'] = colWidths;

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
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No Excel file uploaded.' });
    }

    const year = req.body.year || new Date().getFullYear().toString();
    const wb = xlsx.readFile(req.file.path);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    const existingRecords = await getAllRecords();
    const existingMap = new Map();
    existingRecords.forEach(r => {
      const key = `${r.email.toLowerCase()}__${r.name.toLowerCase()}`;
      existingMap.set(key, r);
    });

    let newCount = 0;
    let updatedCount = 0;

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
          } catch (e) {
            firstPaymentDate = String(rawDate);
          }
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
        // Update existing record
        const updatedPayments = { ...(existing.payments || {}) };
        updatedPayments[year] = { ...(updatedPayments[year] || {}), ...yearPayments };

        const updateData = {
          firstPaymentDate: firstPaymentDate || existing.firstPaymentDate,
          nextDueDate: cycle ? cycle.nextDate : (existing.nextDueDate || ''),
          dueDay: cycle ? cycle.dueDay : (existing.dueDay || null),
          payments: updatedPayments,
          updatedAt: new Date()
        };

        if (isConnectedToAtlas && mongoClient) {
          const db = mongoClient.db(DB_NAME);
          let queryId;
          try { queryId = new ObjectId(existing._id); } catch (e) { queryId = existing._id; }
          await db.collection(COLLECTION_NAME).updateOne({ _id: queryId }, { $set: updateData });
        }

        const idx = localStore.findIndex(r => r._id === existing._id || String(r._id) === String(existing._id));
        if (idx !== -1) {
          localStore[idx] = { ...localStore[idx], ...updateData };
        }
        updatedCount++;
      } else {
        // Create new record
        const newRecord = {
          email,
          name: name || 'Unnamed',
          monthlyFee: 5,
          currency: '$',
          firstPaymentDate,
          nextDueDate: cycle ? cycle.nextDate : '',
          dueDay: cycle ? cycle.dueDay : null,
          notes: '',
          status: 'active',
          payments: {
            [year]: yearPayments
          },
          createdAt: new Date(),
          updatedAt: new Date()
        };

        if (isConnectedToAtlas && mongoClient) {
          const db = mongoClient.db(DB_NAME);
          const result = await db.collection(COLLECTION_NAME).insertOne(newRecord);
          newRecord._id = result.insertedId.toString();
        } else {
          newRecord._id = 'local_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        }

        localStore.push(newRecord);
        newCount++;
      }
    }

    saveLocalBackup(localStore);

    // Clean up uploaded file
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    res.json({
      success: true,
      message: `Import completed: ${newCount} added, ${updatedCount} updated.`
    });
  } catch (err) {
    console.error('Error importing Excel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Start server
async function startServer() {
  await connectToMongo();
  if (process.env.VERCEL !== '1') {
    app.listen(PORT, () => {
      console.log(`===============================================`);
      console.log(` VPS Fee Management Website is running!`);
      console.log(` URL: http://localhost:${PORT}`);
      console.log(` Database: ${isConnectedToAtlas ? 'MongoDB Atlas' : 'Local Backup'}`);
      console.log(` Total Loaded Records: ${localStore.length}`);
      console.log(`===============================================`);
    });
  }
}

startServer();

// Export for Vercel serverless
module.exports = app;
