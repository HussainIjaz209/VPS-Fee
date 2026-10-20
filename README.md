# VPS Fee Tracker & Personal Management System

A personal web application designed to track VPS clients, their monthly fee payment statuses, and immediately identify **who paid** and **who needs to pay**.

Built with **Node.js, Express, MongoDB Atlas, and Tailwind CSS**.

---

## 🚀 Features

1. **Simple Identity & Automatic Cycle**:
   - Add records using **User Email** and **Name** / VPS identifier (no verification required).
   - **Monthly Fee is set to $5** by default.
   - For new users, **1st Payment Date defaults to the current date**.
   - Current month is marked as **PAID** today.
   - Next month is automatically marked as **NEED TO PAY** on the same date!
   - Support for multiple VPS accounts per email (e.g. `Junaid 1`, `Junaid 2`, `Deeja 1`, etc.).

2. **Track Who Paid & Who Needs to Pay**:
   - Month-by-month interactive grid (`January` to `December`) for any selected year (default `2026`).
   - One-click cycle: **Unset** `—` ➔ **Paid** `✓` (Green) ➔ **Need to Pay** `!` (Red) ➔ **Unset**.
   - Dedicated filter tabs:
     - **All Users**
     - **Need to Pay** (Instantly lists everyone with pending dues for the selected month)
     - **Paid** (Lists all cleared payments)
     - **Unset** (Pending status update)

3. **Dashboard Summary & Metrics**:
   - Total VPS Accounts.
   - Paid count & completion percentage for the selected month.
   - Pending / Due count highlighted in red.
   - Total fee collected vs pending revenue.

4. **1-Click WhatsApp / Email Reminder Generator**:
   - Click **"Unpaid List"** to see everyone due for the active month and copy a ready-to-send payment reminder template.

5. **Excel Import & Export**:
   - **Export to Excel**: Download the complete spreadsheet formatted to match your original Excel file.
   - **Import Excel**: Upload `.xlsx` files to batch update or add records anytime.
   - Pre-seeded with all 35 records from your `VPS Fee Record.xlsx`.

6. **Database & Storage**:
   - **MongoDB Atlas**: Connected to your live cloud cluster.
   - **Local Backup**: Automatically saves a local backup in `data/local-backup.json` to keep working even offline.

---

## 🖥️ How to Run

### Method 1: Double-click (Easiest)
Simply double-click `run.bat` in this folder. It will start the server and open your browser automatically to `http://localhost:3000`.

### Method 2: Terminal
```bash
npm start
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📁 File Structure

- `server.js` - Express backend API & MongoDB Atlas connection
- `public/index.html` - Dashboard HTML interface
- `public/app.js` - Interactive dashboard client logic
- `public/styles.css` - Custom styling & indicators
- `scripts/seed.js` - Initial migration script for `VPS Fee Record.xlsx`
- `atlas-credentials.env` - MongoDB Atlas connection credentials
- `run.bat` - 1-click launcher for Windows
