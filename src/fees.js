const { db } = require('./db');
const { currentMonth, monthRange, monthLabel, money } = require('./utils');

const insertDue = db.prepare('INSERT OR IGNORE INTO dues (student_id, month, amount) VALUES (?, ?, ?)');

// Create monthly dues for active students from their fee_start month up to
// the current month. Existing months are left untouched, so a fee change only
// affects months generated after it.
const ensureDues = db.transaction((studentId) => {
  const now = currentMonth();
  const sql = `SELECT s.id, s.fee_start, b.monthly_fee FROM students s
               JOIN batches b ON b.id = s.batch_id WHERE s.active = 1`;
  const students = studentId
    ? db.prepare(sql + ' AND s.id = ?').all(studentId)
    : db.prepare(sql).all();
  for (const s of students) {
    if (s.fee_start > now) continue;
    for (const m of monthRange(s.fee_start, now)) insertDue.run(s.id, m, s.monthly_fee);
  }
});

let lastRunMonth = null;
// Cheap check run on each request: regenerates dues when the month rolls over.
function ensureDuesForMonth() {
  const m = currentMonth();
  if (m !== lastRunMonth) {
    ensureDues();
    lastRunMonth = m;
  }
}

// Allocate payments to dues oldest-first. Returns month-wise status.
function ledger(studentId) {
  const dues = db.prepare('SELECT month, amount FROM dues WHERE student_id = ? ORDER BY month').all(studentId);
  const paid = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM payments WHERE student_id = ?').get(studentId).t;
  let remaining = paid;
  let totalDue = 0;
  const months = dues.map((d) => {
    totalDue += d.amount;
    const applied = Math.min(remaining, d.amount);
    remaining -= applied;
    const status = applied >= d.amount ? 'paid' : applied > 0 ? 'partial' : 'unpaid';
    return { ...d, label: monthLabel(d.month), paid: applied, balance: d.amount - applied, status };
  });
  return {
    months,
    totalDue,
    totalPaid: paid,
    pending: totalDue - paid, // negative means advance credit
    unpaidMonths: months.filter((m) => m.status !== 'paid'),
  };
}

// Describe which months a new payment of `amount` will clear, for the receipt.
function describeAllocation(studentId, amount) {
  const { months } = ledger(studentId);
  let left = amount;
  const parts = [];
  for (const m of months) {
    if (left <= 0) break;
    if (m.balance <= 0) continue;
    const applied = Math.min(left, m.balance);
    left -= applied;
    parts.push(applied === m.amount ? m.label : `${m.label} (Rs. ${money(applied)})`);
  }
  if (left > 0) parts.push(`Advance Rs. ${money(left)}`);
  return parts.join(', ');
}

const pendingSql = `
  SELECT s.id,
         COALESCE((SELECT SUM(amount) FROM dues d WHERE d.student_id = s.id), 0)
       - COALESCE((SELECT SUM(amount) FROM payments p WHERE p.student_id = s.id), 0) AS pending
  FROM students s`;

// Map of student id -> pending amount.
function pendingMap() {
  const rows = db.prepare(pendingSql).all();
  return new Map(rows.map((r) => [r.id, r.pending]));
}

module.exports = { ensureDues, ensureDuesForMonth, ledger, describeAllocation, pendingMap, pendingSql };
