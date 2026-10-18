const router = require('express').Router();
const { db } = require('../db');
const { today, currentMonth, monthRange, addMonths } = require('../utils');

const allBatches = () => db.prepare('SELECT * FROM batches ORDER BY grade, division').all();

// Mark attendance for one class on one date. Unmarked students default to present.
router.get('/attendance', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : today();
  const batches = db.prepare(`
    SELECT b.*,
      (SELECT COUNT(*) FROM students s WHERE s.batch_id = b.id AND s.active = 1) AS students,
      (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
        WHERE s.batch_id = b.id AND a.date = ?) AS marked,
      (SELECT COUNT(*) FROM attendance a JOIN students s ON s.id = a.student_id
        WHERE s.batch_id = b.id AND a.date = ? AND a.present = 1) AS present
    FROM batches b ORDER BY b.grade, b.division`).all(date, date);

  const batchId = Number(req.query.batch) || null;
  const batch = batchId ? batches.find((b) => b.id === batchId) : null;
  let students = [];
  if (batch) {
    students = db.prepare(`
      SELECT s.id, s.name, s.roll_no, a.present FROM students s
      LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
      WHERE s.batch_id = ? AND s.active = 1 ORDER BY s.roll_no IS NULL, CAST(s.roll_no AS INTEGER), s.name`).all(date, batch.id);
  }
  res.render('attendance', { title: 'Attendance', batches, batch, students, date });
});

router.post('/attendance', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : today();
  const batchId = Number(req.body.batch_id);
  if (date > today()) {
    req.flash('err', 'Cannot mark attendance for a future date.');
    return res.redirect(`/attendance?batch=${batchId}&date=${date}`);
  }
  const students = db.prepare('SELECT id FROM students WHERE batch_id = ? AND active = 1').all(batchId);
  const presentIds = new Set([].concat(req.body.present || []).map(Number));
  const upsert = db.prepare(`INSERT INTO attendance (student_id, date, present) VALUES (?, ?, ?)
    ON CONFLICT(student_id, date) DO UPDATE SET present = excluded.present`);
  db.transaction(() => {
    for (const s of students) upsert.run(s.id, date, presentIds.has(s.id) ? 1 : 0);
  })();
  const absent = students.length - students.filter((s) => presentIds.has(s.id)).length;
  req.flash('ok', `Attendance saved: ${students.length - absent} present, ${absent} absent.`);
  res.redirect(`/attendance?date=${date}`);
});

router.post('/attendance/clear', (req, res) => {
  const date = req.body.date;
  const batchId = Number(req.body.batch_id);
  db.prepare(`DELETE FROM attendance WHERE date = ? AND student_id IN
    (SELECT id FROM students WHERE batch_id = ?)`).run(date, batchId);
  req.flash('ok', 'Attendance for that day cleared (e.g. holiday).');
  res.redirect(`/attendance?date=${date}`);
});

// Monthly register for a class: one row per student, one column per marked day.
router.get('/attendance/report', (req, res) => {
  const batches = allBatches();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : currentMonth();
  const batchId = Number(req.query.batch) || batches[0].id;
  const batch = batches.find((b) => b.id === batchId);

  const days = db.prepare(`SELECT DISTINCT a.date FROM attendance a JOIN students s ON s.id = a.student_id
    WHERE s.batch_id = ? AND a.date BETWEEN ? AND ? ORDER BY a.date`)
    .all(batchId, `${month}-01`, `${month}-31`).map((r) => r.date);

  const students = db.prepare(`SELECT id, name, roll_no FROM students WHERE batch_id = ? AND active = 1
    ORDER BY roll_no IS NULL, CAST(roll_no AS INTEGER), name`).all(batchId);
  const marks = db.prepare(`SELECT a.student_id, a.date, a.present FROM attendance a
    JOIN students s ON s.id = a.student_id WHERE s.batch_id = ? AND a.date BETWEEN ? AND ?`)
    .all(batchId, `${month}-01`, `${month}-31`);
  const map = new Map(marks.map((r) => [`${r.student_id}|${r.date}`, r.present]));

  const rows = students.map((s) => {
    const cells = days.map((d) => map.get(`${s.id}|${d}`));
    const total = cells.filter((c) => c !== undefined).length;
    const present = cells.filter((c) => c === 1).length;
    return { ...s, cells, total, present };
  });

  const months = monthRange(addMonths(currentMonth(), -11), currentMonth()).reverse();
  res.render('attendance_report', { title: 'Attendance Report', batches, batch, month, months, days, rows });
});

module.exports = router;
