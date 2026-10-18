const router = require('express').Router();
const { db } = require('../db');
const { ledger, describeAllocation, pendingSql } = require('../fees');
const { writeReceipt } = require('../receipt');
const { today, currentMonth, money, receiptNo, batchName, waPhone, dateLabel } = require('../utils');

const MODES = ['Cash', 'UPI', 'Bank'];

router.get('/collect', (req, res) => {
  const students = db.prepare(`
    SELECT s.id, s.name, s.phone, s.roll_no, b.grade, b.division, b.monthly_fee, p.pending
    FROM students s JOIN batches b ON b.id = s.batch_id JOIN (${pendingSql}) p ON p.id = s.id
    WHERE s.active = 1 ORDER BY s.name`).all();

  let selected = null;
  let led = null;
  if (req.query.student) {
    selected = db.prepare(`SELECT s.*, b.grade, b.division, b.monthly_fee FROM students s
      JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`).get(req.query.student);
    if (selected) led = ledger(selected.id);
  }
  res.render('collect', { title: 'Collect Fee', students, selected, led, modes: MODES, error: null });
});

router.post('/collect', (req, res) => {
  const studentId = Number(req.body.student_id);
  const amount = Math.round(Number(req.body.amount));
  const mode = MODES.includes(req.body.mode) ? req.body.mode : 'Cash';
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(req.body.paid_on || '') ? req.body.paid_on : today();
  const note = (req.body.note || '').trim() || null;

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!student || !(amount > 0)) {
    req.flash('err', 'Select a student and enter an amount greater than zero.');
    return res.redirect(`/collect${student ? '?student=' + studentId : ''}`);
  }

  const id = db.transaction(() => {
    const covered = describeAllocation(studentId, amount);
    const before = ledger(studentId).pending;
    return db.prepare(`INSERT INTO payments (student_id, amount, mode, paid_on, months_covered, balance_after, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(studentId, amount, mode, paidOn, covered, before - amount, note).lastInsertRowid;
  })();

  res.redirect(`/payments/${id}?new=1`);
});

const getPayment = (id) => db.prepare(`
  SELECT p.*, s.name AS student_name, s.phone, s.roll_no, s.parent_name, b.grade, b.division
  FROM payments p JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
  WHERE p.id = ?`).get(id);

router.get('/payments', (req, res) => {
  const m = currentMonth();
  const from = req.query.from || `${m}-01`;
  const to = req.query.to || today();
  const mode = MODES.includes(req.query.mode) ? req.query.mode : '';
  const params = [from, to];
  let extra = '';
  if (mode) { extra = ' AND p.mode = ?'; params.push(mode); }

  const payments = db.prepare(`
    SELECT p.*, s.name AS student_name, b.grade, b.division FROM payments p
    JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
    WHERE p.paid_on BETWEEN ? AND ?${extra} ORDER BY p.paid_on DESC, p.id DESC`).all(...params);
  const total = payments.reduce((a, p) => a + p.amount, 0);

  if (req.query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Receipt', 'Date', 'Student', 'Class', 'Amount', 'Mode', 'Fee for', 'Note'].join(',')];
    for (const p of payments) {
      lines.push([receiptNo(p), p.paid_on, p.student_name, batchName(p), p.amount, p.mode, p.months_covered, p.note]
        .map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments_${from}_to_${to}.csv"`);
    return res.send(lines.join('\n'));
  }

  res.render('payments', { title: 'Payments', payments, total, from, to, mode, modes: MODES });
});

router.get('/payments/:id', (req, res) => {
  const p = getPayment(req.params.id);
  if (!p) return res.status(404).render('message', { title: 'Not found', message: 'Payment not found.' });
  const center = res.locals.settings.center_name;
  const msg = [
    `*${center}* - Fee Receipt`,
    `Receipt: ${receiptNo(p)}`,
    `Student: ${p.student_name} (${batchName(p)})`,
    `Amount: Rs. ${money(p.amount)} (${p.mode})`,
    `For: ${p.months_covered}`,
    `Date: ${dateLabel(p.paid_on)}`,
    p.balance_after > 0 ? `Balance due: Rs. ${money(p.balance_after)}` : 'No balance due. Thank you!',
  ].join('\n');
  const waLink = `https://wa.me/${waPhone(p.phone)}?text=${encodeURIComponent(msg)}`;
  res.render('payment', { title: receiptNo(p), p, waLink, isNew: !!req.query.new });
});

router.get('/payments/:id/receipt.pdf', (req, res) => {
  const p = getPayment(req.params.id);
  if (!p) return res.status(404).send('Not found');
  writeReceipt(res, p);
});

router.post('/payments/:id/delete', (req, res) => {
  const p = getPayment(req.params.id);
  if (!p) return res.redirect('/payments');
  db.prepare('DELETE FROM payments WHERE id = ?').run(p.id);
  req.flash('ok', `Payment ${receiptNo(p)} of Rs. ${money(p.amount)} deleted.`);
  res.redirect(`/students/${p.student_id}`);
});

module.exports = router;
