process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const { db, getSettings, setSetting } = require('./db');
const { ensureDuesForMonth } = require('./fees');
const utils = require('./utils');

const app = express();
const PORT = process.env.PORT || 4200;
const HOST = process.env.HOST || '127.0.0.1';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: false }));

// Session secret is generated once and stored in the database so logins
// survive restarts. SESSION_SECRET overrides it.
let secret = process.env.SESSION_SECRET || getSettings().session_secret;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', secret);
}

app.use(cookieSession({
  name: 'tsess',
  keys: [secret],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
}));

app.use((req, res, next) => {
  res.locals.u = utils;
  res.locals.path = req.path;
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  res.locals.settings = getSettings();
  res.locals.posthog = { key: process.env.POSTHOG_KEY, host: process.env.POSTHOG_HOST };
  req.session.flash = null;
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  next();
});

// ---- Auth ----
const hasUser = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;

app.get('/setup', (req, res) => {
  if (hasUser()) return res.redirect('/login');
  res.render('setup', { title: 'Setup', error: null });
});

app.post('/setup', (req, res) => {
  if (hasUser()) return res.redirect('/login');
  const { username, password, center_name } = req.body;
  if (!username || !password || password.length < 6) {
    return res.render('setup', { title: 'Setup', error: 'Username and a password of at least 6 characters are required.' });
  }
  const info = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username.trim(), bcrypt.hashSync(password, 10));
  if (center_name) setSetting('center_name', center_name.trim());
  req.session.user = { id: info.lastInsertRowid, username: username.trim() };
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (!hasUser()) return res.redirect('/setup');
  res.render('login', { title: 'Login', error: null });
});

// Basic brute-force protection: per-IP failure counter.
const failures = new Map();
app.post('/login', (req, res) => {
  const ip = req.ip;
  const f = failures.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) {
    return res.render('login', { title: 'Login', error: 'Too many attempts. Try again in a few minutes.' });
  }
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    f.n += 1;
    if (f.n >= 5) { f.until = Date.now() + 5 * 60 * 1000; f.n = 0; }
    failures.set(ip, f);
    return res.render('login', { title: 'Login', error: 'Invalid username or password.' });
  }
  failures.delete(ip);
  req.session.user = { id: user.id, username: user.username };
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

app.use((req, res, next) => {
  if (!req.session.user) return res.redirect(hasUser() ? '/login' : '/setup');
  next();
});

app.use((req, res, next) => {
  ensureDuesForMonth();
  next();
});

// ---- App routes ----
app.use(require('./routes/dashboard'));
app.use(require('./routes/students'));
app.use(require('./routes/payments'));
app.use(require('./routes/attendance'));
app.use(require('./routes/settings'));

app.use((req, res) => res.status(404).render('message', { title: 'Not found', message: 'Page not found.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('message', { title: 'Error', message: 'Something went wrong. Please try again.' });
});

app.listen(PORT, HOST, () => console.log(`Tuition manager running on http://${HOST}:${PORT}`));
