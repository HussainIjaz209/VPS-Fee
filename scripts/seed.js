const path = require('path');
const dotenv = require('dotenv');
const xlsx = require('xlsx');
const { MongoClient } = require('mongodb');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', 'atlas-credentials.env') });

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Error: MONGODB_URI not found in atlas-credentials.env');
  process.exit(1);
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

async function seedData() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas successfully.');
    const db = client.db('vps_fee_management');
    const collection = db.collection('vps_records');

    const count = await collection.countDocuments();
    console.log(`Current records in database: ${count}`);

    const force = process.argv.includes('--force');
    if (count > 0 && !force) {
      console.log('Database already contains records. Pass --force to re-import.');
      await client.close();
      return;
    }

    if (force && count > 0) {
      console.log('Clearing existing records due to --force flag...');
      await collection.deleteMany({});
    }

    const excelPath = path.join(__dirname, '..', 'VPS Fee Record.xlsx');
    const wb = xlsx.readFile(excelPath);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    const records = [];
    const currentYear = '2026';

    for (const row of rows) {
      const email = (row['Email'] || '').toString().trim();
      const name = (row['Name'] || '').toString().trim();

      // Skip empty rows
      if (!email && !name) continue;

      let firstPaymentDate = '';
      let recordStatus = 'active';

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
          if (firstPaymentDate.toLowerCase() === 'unlicenced') {
            recordStatus = 'unlicensed';
          }
        }
      }

      const yearPayments = {};
      for (const month of MONTHS) {
        const val = row[month];
        if (val === true || String(val).toLowerCase() === 'true' || String(val).toLowerCase() === 'paid') {
          yearPayments[month] = { status: 'paid', paidDate: firstPaymentDate && month === 'October' ? firstPaymentDate : '' };
        } else if (val === false || String(val).toLowerCase() === 'false' || String(val).toLowerCase() === 'unpaid') {
          yearPayments[month] = { status: 'due' };
        } else {
          yearPayments[month] = { status: 'unset' };
        }
      }

      records.push({
        email: email,
        name: name || 'Unnamed',
        monthlyFee: 5,
        currency: '$',
        firstPaymentDate: firstPaymentDate,
        notes: '',
        status: recordStatus,
        payments: {
          [currentYear]: yearPayments
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    if (records.length > 0) {
      const insertResult = await collection.insertMany(records);
      console.log(`Successfully seeded ${insertResult.insertedCount} VPS records from Excel into MongoDB Atlas!`);
    } else {
      console.log('No valid records found to seed.');
    }

    await client.close();
  } catch (err) {
    console.error('Seeding error:', err);
    process.exit(1);
  }
}

seedData();
