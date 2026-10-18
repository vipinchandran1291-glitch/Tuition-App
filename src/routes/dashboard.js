const router = require('express').Router();
const { db } = require('../db');
const { pendingSql } = require('../fees');
const { today, currentMonth, addMonths, monthLabel } = require('../utils');

router.get('/', (req, res) => {
  const t = today();
  const m = currentMonth();

  const sumBetween = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM payments WHERE paid_on BETWEEN ? AND ?');
  const todayStats = sumBetween.get(t, t);
  const monthStats = sumBetween.get(`${m}-01`, `${m}-31`);

  const pending = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN p.pending > 0 THEN p.pending END), 0) AS total,
           COUNT(CASE WHEN p.pending > 0 THEN 1 END) AS n
    FROM (${pendingSql}) p`).get();

  const modes = db.prepare(`
    SELECT mode, SUM(amount) AS total, COUNT(*) AS n FROM payments
    WHERE paid_on BETWEEN ? AND ? GROUP BY mode ORDER BY total DESC`).all(`${m}-01`, `${m}-31`);

  // Last 6 months collection trend.
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const mm = addMonths(m, -i);
    const r = sumBetween.get(`${mm}-01`, `${mm}-31`);
    trend.push({ month: mm, label: monthLabel(mm).slice(0, 3), total: r.total });
  }
  const trendMax = Math.max(1, ...trend.map((x) => x.total));

  const classes = db.prepare(`
    SELECT b.id, b.grade, b.division, b.monthly_fee,
      (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) AS students,
      (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN students s ON s.id = p.student_id
        WHERE s.batch_id = b.id AND p.paid_on BETWEEN ? AND ?) AS collected,
      (SELECT COALESCE(SUM(CASE WHEN x.pending > 0 THEN x.pending END), 0)
        FROM (${pendingSql}) x JOIN students s ON s.id = x.id WHERE s.batch_id = b.id) AS pending,
      (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
        WHERE s.batch_id = b.id AND a.date = ? AND a.present = 1) AS present,
      (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
        WHERE s.batch_id = b.id AND a.date = ?) AS marked
    FROM batches b ORDER BY b.grade, b.division`).all(`${m}-01`, `${m}-31`, t, t);

  // Students owing more than one month's fee.
  const defaulters = db.prepare(`
    SELECT s.id, s.name, s.phone, b.grade, b.division, b.monthly_fee, p.pending
    FROM (${pendingSql}) p JOIN students s ON s.id = p.id JOIN batches b ON b.id = s.batch_id
    WHERE p.pending > b.monthly_fee
    ORDER BY p.pending DESC LIMIT 10`).all();

  const recent = db.prepare(`
    SELECT p.*, s.name AS student_name, b.grade, b.division FROM payments p
    JOIN students s ON s.id = p.student_id JOIN batches b ON b.id = s.batch_id
    ORDER BY p.id DESC LIMIT 6`).all();

  res.render('dashboard', {
    title: 'Dashboard', todayStats, monthStats, pending, modes, trend, trendMax,
    classes, defaulters, recent, monthName: monthLabel(m),
  });
});

module.exports = router;
