const router = require('express').Router();
const { db } = require('../db');
const { ensureDues, ledger, pendingSql } = require('../fees');
const { today, currentMonth, addMonths, monthLabel } = require('../utils');

const allBatches = () => db.prepare('SELECT * FROM batches ORDER BY grade, division').all();

router.get('/students', (req, res) => {
  const { batch = '', q = '', show = 'active' } = req.query;
  const where = [];
  const params = [];
  if (batch) { where.push('s.batch_id = ?'); params.push(batch); }
  if (q) { where.push('(s.name LIKE ? OR s.phone LIKE ? OR s.parent_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (show === 'active' || show === 'due') where.push('s.active = 1');
  if (show === 'inactive') where.push('s.active = 0');
  if (show === 'due') where.push('p.pending > 0');

  const students = db.prepare(`
    SELECT s.*, b.grade, b.division, p.pending FROM students s
    JOIN batches b ON b.id = s.batch_id JOIN (${pendingSql}) p ON p.id = s.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY b.grade, b.division, s.name`).all(...params);

  res.render('students', { title: 'Students', students, batches: allBatches(), batch, q, show });
});

function readForm(body) {
  return {
    name: (body.name || '').trim(),
    batch_id: Number(body.batch_id),
    roll_no: (body.roll_no || '').trim() || null,
    parent_name: (body.parent_name || '').trim() || null,
    phone: (body.phone || '').trim() || null,
    address: (body.address || '').trim() || null,
    join_date: body.join_date || today(),
    fee_start: body.fee_start || currentMonth(),
  };
}

function validate(s) {
  if (!s.name) return 'Name is required.';
  if (!db.prepare('SELECT 1 FROM batches WHERE id = ?').get(s.batch_id)) return 'Select a class.';
  if (!/^\d{4}-\d{2}$/.test(s.fee_start)) return 'Fee start month is invalid.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.join_date)) return 'Join date is invalid.';
  return null;
}

router.get('/students/new', (req, res) => {
  const student = { batch_id: Number(req.query.batch) || '', join_date: today(), fee_start: currentMonth() };
  res.render('student_form', { title: 'Add Student', student, batches: allBatches(), error: null });
});

router.post('/students', (req, res) => {
  const s = readForm(req.body);
  const error = validate(s);
  if (error) return res.render('student_form', { title: 'Add Student', student: s, batches: allBatches(), error });
  const info = db.prepare(`INSERT INTO students (name, batch_id, roll_no, parent_name, phone, address, join_date, fee_start)
    VALUES (@name, @batch_id, @roll_no, @parent_name, @phone, @address, @join_date, @fee_start)`).run(s);
  ensureDues(info.lastInsertRowid);
  req.flash('ok', `${s.name} added.`);
  if (req.body.another) return res.redirect(`/students/new?batch=${s.batch_id}`);
  res.redirect(`/students/${info.lastInsertRowid}`);
});

const getStudent = (id) => db.prepare(`
  SELECT s.*, b.grade, b.division, b.monthly_fee FROM students s
  JOIN batches b ON b.id = s.batch_id WHERE s.id = ?`).get(id);

router.get('/students/:id', (req, res) => {
  const student = getStudent(req.params.id);
  if (!student) return res.status(404).render('message', { title: 'Not found', message: 'Student not found.' });
  const led = ledger(student.id);
  const payments = db.prepare('SELECT * FROM payments WHERE student_id = ? ORDER BY paid_on DESC, id DESC').all(student.id);

  // Attendance: last 6 months summary + this month's absences.
  const m = currentMonth();
  const attStmt = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(present), 0) AS present
    FROM attendance WHERE student_id = ? AND date BETWEEN ? AND ?`);
  const attendance = [];
  for (let i = 0; i < 6; i++) {
    const mm = addMonths(m, -i);
    const r = attStmt.get(student.id, `${mm}-01`, `${mm}-31`);
    if (r.total || i === 0) attendance.push({ label: monthLabel(mm), ...r });
  }
  const overall = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(present), 0) AS present
    FROM attendance WHERE student_id = ?`).get(student.id);
  const absences = db.prepare(`SELECT date FROM attendance WHERE student_id = ? AND present = 0
    ORDER BY date DESC LIMIT 10`).all(student.id);

  res.render('student', {
    title: student.name, student, led, payments, attendance, overall, absences,
  });
});

router.get('/students/:id/edit', (req, res) => {
  const student = getStudent(req.params.id);
  if (!student) return res.redirect('/students');
  res.render('student_form', { title: 'Edit Student', student, batches: allBatches(), error: null });
});

router.post('/students/:id', (req, res) => {
  const existing = getStudent(req.params.id);
  if (!existing) return res.redirect('/students');
  const s = { ...readForm(req.body), id: existing.id };
  const error = validate(s);
  if (error) return res.render('student_form', { title: 'Edit Student', student: s, batches: allBatches(), error });
  db.transaction(() => {
    db.prepare(`UPDATE students SET name=@name, batch_id=@batch_id, roll_no=@roll_no, parent_name=@parent_name,
      phone=@phone, address=@address, join_date=@join_date, fee_start=@fee_start WHERE id=@id`).run(s);
    // Fee start moved later: drop dues before it.
    db.prepare('DELETE FROM dues WHERE student_id = ? AND month < ?').run(s.id, s.fee_start);
    ensureDues(s.id);
  })();
  req.flash('ok', 'Student updated.');
  res.redirect(`/students/${s.id}`);
});

router.post('/students/:id/active', (req, res) => {
  const s = getStudent(req.params.id);
  if (!s) return res.redirect('/students');
  if (s.active) {
    // Leaving: stop dues after this month.
    db.transaction(() => {
      db.prepare('UPDATE students SET active = 0, left_on = ? WHERE id = ?').run(today(), s.id);
      db.prepare('DELETE FROM dues WHERE student_id = ? AND month > ?').run(s.id, currentMonth());
    })();
    req.flash('ok', `${s.name} marked as left. No new fees will be added.`);
  } else {
    db.prepare('UPDATE students SET active = 1, left_on = NULL WHERE id = ?').run(s.id);
    ensureDues(s.id);
    req.flash('ok', `${s.name} re-activated.`);
  }
  res.redirect(`/students/${s.id}`);
});

router.post('/students/:id/delete', (req, res) => {
  const s = getStudent(req.params.id);
  if (!s) return res.redirect('/students');
  const paid = db.prepare('SELECT COUNT(*) AS n FROM payments WHERE student_id = ?').get(s.id).n;
  if (paid) {
    req.flash('err', 'This student has payments recorded. Mark them as left instead of deleting.');
    return res.redirect(`/students/${s.id}`);
  }
  db.prepare('DELETE FROM students WHERE id = ?').run(s.id);
  req.flash('ok', `${s.name} deleted.`);
  res.redirect('/students');
});

module.exports = router;
