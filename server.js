require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8081;
const INVITE_CODE = process.env.SFZ_INVITE_CODE || null;
const GATE_TOKEN = process.env.SFZ_GATE_TOKEN || null;
const COOKIE_SECURE = process.env.SFZ_SECURE_COOKIE === 'true';

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {error: 'Zu viele Anfragen. Bitte später versuchen.'}
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {error: 'Zu viele Login-Versuche.'}
});

app.use(bodyParser.json({limit: '10mb'}));
app.use(cookieParser());

// Optional: URL-Gate gegen einfache Scraper
if (GATE_TOKEN) {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (req.method !== 'GET') return next();

    // Allow static assets without gate (needed for app.js/css)
    if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf)$/)) {
      return next();
    }

    const gateCookie = req.cookies.sfz_gate === '1';
    const token = req.query.token;

    if (token && token === GATE_TOKEN) {
      res.cookie('sfz_gate', '1', {
        httpOnly: true,
        sameSite: 'Lax',
        secure: COOKIE_SECURE,
        maxAge: 30 * 24 * 60 * 60 * 1000
      });
      return next();
    }

    if (gateCookie) return next();
    return res.status(403).send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SFZ Zugang</title>
  <style>
    body{font-family:Inter,system-ui,Arial,sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .box{background:#111827;border:1px solid #334155;border-radius:16px;padding:28px;max-width:420px;width:90%}
    h1{margin:0 0 8px 0;font-size:1.4rem}
    p{color:#94a3b8;line-height:1.5}
    input{width:100%;padding:12px 14px;border-radius:8px;border:1px solid #334155;background:#0b1220;color:#e2e8f0;margin:12px 0}
    button{width:100%;padding:12px 14px;border-radius:8px;border:none;background:#6366f1;color:white;font-weight:600;cursor:pointer}
  </style>
</head>
<body>
  <div class="box">
    <h1>Zugang nur mit Token</h1>
    <p>Bitte gib deinen Zugangscode ein. Danach wirst du weitergeleitet.</p>
    <form onsubmit="event.preventDefault(); const t=document.getElementById('t').value; if(t){ window.location='/?token='+encodeURIComponent(t); }">
      <input id="t" placeholder="Token eingeben" />
      <button type="submit">Weiter</button>
    </form>
  </div>
</body>
</html>`);
  });
}

app.use(express.static('public'));

// Root route -> index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Admin Panel Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// SQLite DB
const db = new sqlite3.Database('./sfz.db', (err) => {
  if (err) console.error(err.message);
  else console.log('Connected to SQLite');
});

// Tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    grade TEXT,
    interests TEXT,
    skills TEXT,
    contact TEXT,
    password_hash TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    tags TEXT,
    type TEXT DEFAULT 'angebot',
    price TEXT,
    vb INTEGER DEFAULT 0,
    image_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS bugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'bug',
    reporter TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function createSession(userId, cb) {
  const token = crypto.randomBytes(32).toString('hex');
  db.run(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`,
    [userId, token],
    (err) => cb(err, token)
  );
}

function requireLogin(req, res, next) {
  const token = req.cookies.sfz_session || req.headers['x-sfz-session'];
  if (!token) return res.status(401).json({error: 'Nicht eingeloggt'});

  const sql = `
    SELECT u.id, u.name, u.grade, u.interests, u.skills, u.contact, u.is_admin
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `;

  db.get(sql, [token], (err, user) => {
    if (err || !user) return res.status(401).json({error: 'Session abgelaufen'});
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.is_admin !== 1) return res.status(403).json({error: 'Kein Admin-Zugang'});
  next();
}

// Auth
app.post('/api/register', authLimiter, (req, res) => {
  const {name, grade, interests, skills, contact, password, inviteCode} = req.body;
  if (!name || !password) return res.status(400).json({error: 'Name und Passwort erforderlich'});

  if (INVITE_CODE && inviteCode !== INVITE_CODE) {
    return res.status(403).json({error: 'Ungültiger Invite-Code'});
  }

  db.get(`SELECT id FROM users WHERE name = ?`, [name], (err, existing) => {
    if (existing) return res.status(409).json({error: 'Name bereits vergeben'});

    const password_hash = bcrypt.hashSync(password, 10);
    const sql = `INSERT INTO users (name, grade, interests, skills, contact, password_hash) VALUES (?,?,?,?,?,?)`;
    db.run(sql, [name, grade, interests, skills, contact, password_hash], function(err) {
      if (err) return res.status(500).json({error: err.message});

      createSession(this.lastID, (sessErr, token) => {
        if (sessErr) return res.status(500).json({error: sessErr.message});
        res.cookie('sfz_session', token, {
          httpOnly: true,
          sameSite: 'Lax',
          secure: COOKIE_SECURE,
          maxAge: 30 * 24 * 60 * 60 * 1000
        });
        res.json({id: this.lastID, name, grade, interests, skills, contact, is_admin: 0});
      });
    });
  });
});

app.post('/api/login', authLimiter, (req, res) => {
  const {name, password} = req.body;
  if (!name || !password) return res.status(400).json({error: 'Name und Passwort erforderlich'});

  db.get(`SELECT * FROM users WHERE name = ?`, [name], (err, user) => {
    if (err || !user) return res.status(401).json({error: 'User nicht gefunden'});
    if (!user.password_hash) return res.status(401).json({error: 'Kein Passwort gesetzt'});

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({error: 'Falsches Passwort'});
    }

    createSession(user.id, (sessErr, token) => {
      if (sessErr) return res.status(500).json({error: sessErr.message});
      res.cookie('sfz_session', token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: COOKIE_SECURE,
        maxAge: 30 * 24 * 60 * 60 * 1000
      });
      res.json({
        id: user.id,
        name: user.name,
        grade: user.grade,
        interests: user.interests,
        skills: user.skills,
        contact: user.contact,
        is_admin: user.is_admin == 1
      });
    });
  });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies.sfz_session || req.headers['x-sfz-session'];
  if (!token) return res.json({ok: true});
  db.run(`DELETE FROM sessions WHERE token = ?`, [token], () => {
    res.clearCookie('sfz_session');
    res.json({ok: true});
  });
});

app.get('/api/me', requireLogin, (req, res) => {
  res.json(req.user);
});

// Upload Setup (optional)
const upload = multer({
  dest: 'public/uploads/',
  limits: {fileSize: 5 * 1024 * 1024},
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Nur Bilder erlaubt'));
  }
});

const uploadMaybe = (req, res, next) => {
  if (req.is('multipart/form-data')) return upload.single('image')(req, res, next);
  return next();
};

if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', {recursive: true});
}

// Listings (privat)
app.get('/api/listings', apiLimiter, requireLogin, (req, res) => {
  const sql = `
    SELECT l.*, u.name as author_name, u.grade, u.interests, u.contact as contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id 
    ORDER BY l.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

app.get('/api/users/:id/listings', apiLimiter, requireLogin, (req, res) => {
  const userId = req.params.id;
  db.all(`SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

app.get('/api/discover', apiLimiter, requireLogin, (req, res) => {
  const sql = `
    SELECT l.*, u.name as author_name, u.grade, u.interests, u.skills, u.contact as contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id
    ORDER BY RANDOM() LIMIT 5
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

app.get('/api/match/:userId', apiLimiter, requireLogin, (req, res) => {
  const userId = req.params.userId;
  db.get(`SELECT interests, skills FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err || !user) return res.status(404).json({error: 'User not found'});
    const keywords = (user.interests + ' ' + user.skills).toLowerCase().split(/[ ,]+/);

    db.all(`SELECT l.*, u.name as author_name FROM listings l JOIN users u ON l.user_id = u.id WHERE l.user_id != ?`, [userId], (err, rows) => {
      if (err) return res.status(500).json({error: err.message});

      const scored = rows.map(row => {
        const text = (row.title + ' ' + row.description + ' ' + row.tags).toLowerCase();
        let score = 0;
        keywords.forEach(kw => { if (kw && text.includes(kw)) score++; });
        return {...row, score};
      });

      res.json(scored.filter(r => r.score > 0).sort((a,b) => b.score - a.score).slice(0, 5));
    });
  });
});

app.post('/api/listings', requireLogin, uploadMaybe, (req, res) => {
  const {title, description, category, tags, type, price, vb} = req.body;
  const image_path = req.file ? '/uploads/' + req.file.filename : null;

  const sql = `INSERT INTO listings (user_id, title, description, category, tags, type, price, vb, image_path) VALUES (?,?,?,?,?,?,?,?,?)`;
  db.run(sql, [req.user.id, title, description, category, tags, type, price || '', vb ? 1 : 0, image_path], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({id: this.lastID, image_path});
  });
});

app.put('/api/listings/:id', requireLogin, (req, res) => {
  const listingId = req.params.id;
  const {title, description, category, tags, price, vb} = req.body;

  db.get(`SELECT user_id FROM listings WHERE id = ?`, [listingId], (err, row) => {
    if (err || !row) return res.status(404).json({error: 'Listing nicht gefunden'});
    if (row.user_id !== req.user.id && req.user.is_admin !== 1) return res.status(403).json({error: 'Nicht erlaubt'});

    const sql = `UPDATE listings SET title=?, description=?, category=?, tags=?, price=?, vb=? WHERE id=?`;
    db.run(sql, [title, description, category, tags, price, vb ? 1 : 0, listingId], function(err) {
      if (err) return res.status(500).json({error: err.message});
      res.json({updated: this.changes});
    });
  });
});

app.delete('/api/listings/:id', requireLogin, (req, res) => {
  const listingId = req.params.id;

  db.get(`SELECT user_id, image_path FROM listings WHERE id = ?`, [listingId], (err, row) => {
    if (err || !row) return res.status(404).json({error: 'Listing nicht gefunden'});
    if (row.user_id !== req.user.id && req.user.is_admin !== 1) return res.status(403).json({error: 'Nicht erlaubt'});

    if (row.image_path) {
      const imgPath = path.join(__dirname, 'public', row.image_path);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    db.run(`DELETE FROM listings WHERE id = ?`, [listingId], function(err) {
      if (err) return res.status(500).json({error: err.message});
      res.json({deleted: this.changes});
    });
  });
});

app.get('/api/users', apiLimiter, requireLogin, (req, res) => {
  db.all(`SELECT id, name, grade, interests, skills, contact, is_admin, created_at FROM users ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

app.get('/api/search', apiLimiter, requireLogin, (req, res) => {
  const {q} = req.query;
  const sql = `
    SELECT l.*, u.name as author_name, u.contact as contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id 
    WHERE l.title LIKE ? OR l.description LIKE ? OR l.tags LIKE ?
    ORDER BY l.created_at DESC
  `;
  const like = `%${q}%`;
  db.all(sql, [like, like, like], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Bug Reports (öffentlich)
app.get('/api/bugs', requireLogin, requireAdmin, (req, res) => {
  db.all(`SELECT * FROM bugs ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

app.post('/api/bugs', apiLimiter, (req, res) => {
  const {title, description, category, reporter} = req.body;
  const sql = `INSERT INTO bugs (title, description, category, reporter) VALUES (?,?,?,?)`;
  db.run(sql, [title, description, category || 'bug', reporter || 'Anonymous'], function(err) {
    if (err) return res.status(500).json({error: err.message});

    const logLine = `[${new Date().toISOString()}] ${category || 'bug'}: ${title} - ${reporter || 'Anonymous'}\n`;
    fs.appendFileSync('./bugs.log', logLine);

    res.json({id: this.lastID, success: true});
  });
});

app.put('/api/bugs/:id', requireLogin, requireAdmin, (req, res) => {
  const {status} = req.body;
  db.run(`UPDATE bugs SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({updated: this.changes});
  });
});

app.get('/api/admin/stats', requireLogin, requireAdmin, (req, res) => {
  db.get(`SELECT COUNT(*) as users FROM users`, [], (err, users) => {
    db.get(`SELECT COUNT(*) as listings FROM listings`, [], (err, listings) => {
      db.get(`SELECT COUNT(*) as bugs FROM bugs`, [], (err, bugs) => {
        res.json({users: users.users, listings: listings.listings, bugs: bugs.bugs});
      });
    });
  });
});

app.listen(PORT, () => {
  console.log(`SFZ Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
});
