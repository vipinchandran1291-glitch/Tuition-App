const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db, setSetting } = require('../db');
const { currentMonth } = require('../utils');

router.get('/more', (req, res) => {
  const batches = db.prepare('SELECT * FROM batches ORDER BY grade, division').all();
  res.render('settings', { title: 'More', batches });
});

router.post('/settings/center', (req, res) => {
  for (const key of ['center_name', 'center_address', 'center_phone']) {
    setSetting(key, (req.body[key] || '').trim());
  }
  req.flash('ok', 'Center details saved.');
  res.redirect('/more');
});

// New fee applies to future months, and optionally to the current month.
router.post('/settings/fees', (req, res) => {
  const batches = db.prepare('SELECT id FROM batches').all();
  const update = db.prepare('UPDATE batches SET monthly_fee = ? WHERE id = ?');
  const updateDues = db.prepare(`UPDATE dues SET amount = ? WHERE month = ? AND student_id IN
    (SELECT id FROM students WHERE batch_id = ?)`);
  db.transaction(() => {
    for (const b of batches) {
      const fee = Math.round(Number(req.body[`fee_${b.id}`]));
      if (fee > 0) {
        update.run(fee, b.id);
        if (req.body.apply_current) updateDues.run(fee, currentMonth(), b.id);
      }
    }
  })();
  req.flash('ok', 'Monthly fees updated.');
  res.redirect('/more');
});

router.post('/settings/password', (req, res) => {
  const { current, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || !bcrypt.compareSync(current || '', user.password_hash)) {
    req.flash('err', 'Current password is incorrect.');
  } else if (!password || password.length < 6) {
    req.flash('err', 'New password must be at least 6 characters.');
  } else {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
    req.flash('ok', 'Password changed.');
  }
  res.redirect('/more');
});

module.exports = router;
