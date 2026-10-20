const path = require('path');
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');

dotenv.config({ path: path.join(__dirname, '..', 'atlas-credentials.env') });

async function migrate() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db('vps_fee_management');
    const collection = db.collection('vps_records');

    // 1. Update all records to $5 monthly fee
    const result = await collection.updateMany(
      {},
      { $set: { monthlyFee: 5 } }
    );
    console.log(`Updated ${result.modifiedCount} records to $5 monthly fee.`);

    // 2. Update nextDueDate for all records with firstPaymentDate
    const records = await collection.find({}).toArray();
    let updatedDueDates = 0;

    for (const doc of records) {
      const dStr = doc.firstPaymentDate;
      if (dStr && !dStr.toLowerCase().includes('unlicenc')) {
        const parts = dStr.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const d = parseInt(parts[2], 10);
          const nextMonth = new Date(y, m + 1, d);
          const nextDueDate = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-${String(nextMonth.getDate()).padStart(2, '0')}`;

          await collection.updateOne(
            { _id: doc._id },
            { $set: { nextDueDate, dueDay: d } }
          );
          updatedDueDates++;
        }
      }
    }

    console.log(`Updated nextDueDate for ${updatedDueDates} existing records.`);
    await client.close();
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

migrate();
