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
// Trust Cloudflare proxy (needed for secure cookies & correct IP logging)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 8081;
const INVITE_CODE = process.env.SFZ_INVITE_CODE;
if (!INVITE_CODE) {
  console.error("FATAL ERROR: SFZ_INVITE_CODE is not set in the environment.");
  process.exit(1);
}
const COOKIE_SECURE = process.env.SFZ_SECURE_COOKIE === 'true';

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: {error: 'Zu viele Anfragen. Bitte später versuchen.'}
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Stricter limit
  handler: (req, res) => {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, 'Too many login attempts');
    res.status(429).json({error: 'Zu viele Login-Versuche. Bitte warten.'});
  }
});

app.use(bodyParser.json({limit: '10mb'}));
app.use(cookieParser());

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
    full_name TEXT,
    grade TEXT,
    interests TEXT,
    skills TEXT,
    contact TEXT,
    hide_contact INTEGER DEFAULT 0,
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
    image_paths TEXT,
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
  
  // Migration for existing tables
  db.all("PRAGMA table_info(bugs)", (err, rows) => {
    if (err) return;
    const columns = rows.map(r => r.name);
    if (!columns.includes('status')) {
      db.run("ALTER TABLE bugs ADD COLUMN status TEXT DEFAULT 'open'");
    }
    if (!columns.includes('category')) {
      db.run("ALTER TABLE bugs ADD COLUMN category TEXT DEFAULT 'bug'");
    }
  });

  // Listings Migration for image_paths
  db.all("PRAGMA table_info(listings)", (err, rows) => {
    if (err) return;
    const columns = rows.map(r => r.name);
    if (!columns.includes('image_paths')) {
      db.run("ALTER TABLE listings ADD COLUMN image_paths TEXT");
    }
  });

  // Users Migration for hide_contact and full_name
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err) return;
    const columns = rows.map(r => r.name);
    if (!columns.includes('hide_contact')) {
      db.run("ALTER TABLE users ADD COLUMN hide_contact INTEGER DEFAULT 0");
    }
    if (!columns.includes('full_name')) {
      db.run("ALTER TABLE users ADD COLUMN full_name TEXT");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    ip_address TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function logSecurityEvent(type, req, details = '') {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    db.run(`INSERT INTO security_logs (event_type, ip_address, details) VALUES (?, ?, ?)`, 
        [type, ip, details], 
        (err) => {
            if (err) console.error('Error logging security event:', err);
        }
    );
}

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
    SELECT u.id, u.name, u.full_name, u.grade, u.interests, u.skills, u.contact, u.hide_contact, u.is_admin
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
  // 'name' is the username (login), 'full_name' is the display name
  const {name, full_name, grade, interests, skills, contact, password, inviteCode} = req.body;
  if (!name || !password) return res.status(400).json({error: 'Benutzername und Passwort erforderlich'});

  if (!inviteCode || inviteCode !== INVITE_CODE) {
    logSecurityEvent('REGISTER_FAIL_INVITE', req, `Invalid invite code: ${inviteCode}`);
    return res.status(403).json({error: 'Ungültiger Invite-Code'});
  }

  db.get(`SELECT id FROM users WHERE name = ?`, [name], (err, existing) => {
    if (existing) {
        logSecurityEvent('REGISTER_FAIL_EXISTS', req, `Username taken: ${name}`);
        return res.status(409).json({error: 'Benutzername bereits vergeben'});
    }

    const password_hash = bcrypt.hashSync(password, 10);
    const sql = `INSERT INTO users (name, full_name, grade, interests, skills, contact, password_hash) VALUES (?,?,?,?,?,?,?)`;
    db.run(sql, [name, full_name || name, grade, interests, skills, contact, password_hash], function(err) {
      if (err) return res.status(500).json({error: err.message});

      createSession(this.lastID, (sessErr, token) => {
        if (sessErr) return res.status(500).json({error: sessErr.message});
        
        logSecurityEvent('REGISTER_SUCCESS', req, `New user: ${name}`);
        
        res.cookie('sfz_session', token, {
          httpOnly: true,
          sameSite: 'Lax',
          secure: COOKIE_SECURE,
          maxAge: 30 * 24 * 60 * 60 * 1000
        });
        res.json({id: this.lastID, name, full_name: full_name || name, grade, interests, skills, contact, is_admin: 0});
      });
    });
  });
});

app.post('/api/login', authLimiter, (req, res) => {
  const {name, password} = req.body;
  if (!name || !password) return res.status(400).json({error: 'Name und Passwort erforderlich'});

  db.get(`SELECT * FROM users WHERE name = ?`, [name], (err, user) => {
    if (err || !user) {
        logSecurityEvent('LOGIN_FAILED_USER', req, `User not found: ${name}`);
        return res.status(401).json({error: 'User nicht gefunden'});
    }
    if (!user.password_hash) return res.status(401).json({error: 'Kein Passwort gesetzt'});

    if (!bcrypt.compareSync(password, user.password_hash)) {
      logSecurityEvent('LOGIN_FAILED_PASS', req, `Wrong password for user: ${name}`);
      return res.status(401).json({error: 'Falsches Passwort'});
    }

    createSession(user.id, (sessErr, token) => {
      if (sessErr) return res.status(500).json({error: sessErr.message});
      logSecurityEvent('LOGIN_SUCCESS', req, `User logged in: ${name}`);
      res.cookie('sfz_session', token, {
        httpOnly: true,
        sameSite: 'Lax',
        secure: COOKIE_SECURE,
        maxAge: 30 * 24 * 60 * 60 * 1000
      });
      res.json({
        id: user.id,
        name: user.name,
        full_name: user.full_name,
        grade: user.grade,
        interests: user.interests,
        skills: user.skills,
        contact: user.contact,
        hide_contact: user.hide_contact,
        is_admin: user.is_admin == 1
      });
    });
  });
});

// Admin User Management - Uses actual contact info, admins can see everything
app.get('/api/admin/users', requireLogin, requireAdmin, (req, res) => {
  db.all(`SELECT id, name, full_name, grade, is_admin, created_at FROM users ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

app.put('/api/admin/users/:id/role', requireLogin, requireAdmin, (req, res) => {
  const userId = req.params.id;
  if (userId == req.user.id) return res.status(403).json({error: 'Cannot change own role'});
  
  const {is_admin} = req.body;
  db.run(`UPDATE users SET is_admin = ? WHERE id = ?`, [is_admin ? 1 : 0, userId], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({updated: this.changes});
  });
});

app.delete('/api/admin/users/:id', requireLogin, requireAdmin, (req, res) => {
  const userId = req.params.id;
  if (userId == req.user.id) return res.status(403).json({error: 'Cannot delete own account'});
  
  db.serialize(() => {
    // 1. Delete sessions
    db.run(`DELETE FROM sessions WHERE user_id = ?`, [userId]);
    
    // 2. Delete listings images
    db.all(`SELECT image_path, image_paths FROM listings WHERE user_id = ?`, [userId], (err, rows) => {
      if (!err && rows) {
        rows.forEach(row => {
          try {
            if (row.image_path) {
               const p = path.join(__dirname, 'public', row.image_path);
               if (fs.existsSync(p)) fs.unlinkSync(p);
            }
            if (row.image_paths) {
                JSON.parse(row.image_paths).forEach(p => {
                    const fullP = path.join(__dirname, 'public', p);
                    if (fs.existsSync(fullP)) fs.unlinkSync(fullP);
                });
            }
          } catch(e) {}
        });
      }
    });

    // 3. Delete listings
    db.run(`DELETE FROM listings WHERE user_id = ?`, [userId]);

    // 4. Delete user
    db.run(`DELETE FROM users WHERE id = ?`, [userId], function(err) {
        if (err) return res.status(500).json({error: err.message});
        res.json({deleted: this.changes});
    });
  });
});

app.get('/api/admin/logs', requireLogin, requireAdmin, (req, res) => {
    db.all(`SELECT * FROM security_logs ORDER BY created_at DESC LIMIT 50`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
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
  limits: {fileSize: 5 * 1024 * 1024, files: 5},
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Nur Bilder (JPG, PNG, WEBP) erlaubt'));
    }
  }
});

const uploadMaybe = (req, res, next) => {
  if (req.is('multipart/form-data')) return upload.array('images', 5)(req, res, next);
  return next();
};

if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', {recursive: true});
}

// Listings (privat)
// Updated to use full_name as author_name (with fallback to name)
app.get('/api/listings', apiLimiter, requireLogin, (req, res) => {
  const sql = `
    SELECT l.*, COALESCE(u.full_name, u.name) as author_name, u.grade, u.interests,
    CASE WHEN u.hide_contact = 1 THEN NULL ELSE u.contact END as contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id 
    ORDER BY l.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Updated to use full_name
app.get('/api/users/:id/listings', apiLimiter, requireLogin, (req, res) => {
  const userId = req.params.id;
  const sql = `
    SELECT l.*, COALESCE(u.full_name, u.name) as author_name, u.grade, u.interests,
    CASE WHEN u.hide_contact = 1 THEN NULL ELSE u.contact END as contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id 
    WHERE l.user_id = ? 
    ORDER BY l.created_at DESC
  `;
  db.all(sql, [userId], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Updated to use full_name
app.get('/api/discover', apiLimiter, requireLogin, (req, res) => {
  const sql = `
    SELECT l.*, COALESCE(u.full_name, u.name) as author_name, u.grade, u.interests, u.skills,
    CASE WHEN u.hide_contact = 1 THEN NULL ELSE u.contact END as contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id
    ORDER BY l.created_at DESC LIMIT 6
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Updated to use full_name
app.get('/api/match/:userId', apiLimiter, requireLogin, (req, res) => {
  const userId = req.params.userId;
  db.get(`SELECT interests, skills FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err || !user) return res.status(404).json({error: 'User not found'});
    const interests = user.interests || '';
    const skills = user.skills || '';
    const keywords = (interests + ' ' + skills).toLowerCase().split(/[ ,]+/).filter(Boolean);

    db.all(`SELECT l.*, COALESCE(u.full_name, u.name) as author_name FROM listings l JOIN users u ON l.user_id = u.id WHERE l.user_id != ?`, [userId], (err, rows) => {
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
  if (!title || title.length > 100) return res.status(400).json({error: 'Titel ungültig (max 100 Zeichen)'});
  if (description && description.length > 2000) return res.status(400).json({error: 'Beschreibung zu lang'});

  const files = req.files || [];
  const image_paths = files.map(f => '/uploads/' + f.filename);
  const image_path = image_paths[0] || null;

  const sql = `INSERT INTO listings (user_id, title, description, category, tags, type, price, vb, image_path, image_paths) VALUES (?,?,?,?,?,?,?,?,?,?)`;
  db.run(sql, [req.user.id, title, description, category, tags, type, price || '', vb ? 1 : 0, image_path, JSON.stringify(image_paths)], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({id: this.lastID, image_path, image_paths});
  });
});

app.put('/api/listings/:id', requireLogin, (req, res) => {
  const listingId = req.params.id;
  const {title, type, description, category, tags, price, vb} = req.body;

  db.get(`SELECT user_id FROM listings WHERE id = ?`, [listingId], (err, row) => {
    if (err || !row) return res.status(404).json({error: 'Listing nicht gefunden'});
    if (row.user_id !== req.user.id && req.user.is_admin !== 1) return res.status(403).json({error: 'Nicht erlaubt'});

    const sql = `UPDATE listings SET title=?, type=?, description=?, category=?, tags=?, price=?, vb=? WHERE id=?`;
    db.run(sql, [title, type, description, category, tags, price, vb ? 1 : 0, listingId], function(err) {
      if (err) return res.status(500).json({error: err.message});
      res.json({updated: this.changes});
    });
  });
});

app.delete('/api/listings/:id', requireLogin, (req, res) => {
  const listingId = req.params.id;

  db.get(`SELECT user_id, image_paths FROM listings WHERE id = ?`, [listingId], (err, row) => {
    if (err || !row) return res.status(404).json({error: 'Listing nicht gefunden'});
    if (row.user_id !== req.user.id && req.user.is_admin !== 1) return res.status(403).json({error: 'Nicht erlaubt'});

    if (row.image_paths) {
      try {
        const paths = JSON.parse(row.image_paths);
        paths.forEach(p => {
          const imgPath = path.join(__dirname, 'public', p);
          if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        });
      } catch (e) {
        console.error('Error parsing image_paths:', e);
      }
    }

    db.run(`DELETE FROM listings WHERE id = ?`, [listingId], function(err) {
      if (err) return res.status(500).json({error: err.message});
      res.json({deleted: this.changes});
    });
  });
});

// Updated to use full_name
app.get('/api/users', apiLimiter, requireLogin, (req, res) => {
  const sql = `
    SELECT id, COALESCE(full_name, name) as name, name as username, grade, interests, skills, is_admin, created_at,
    CASE WHEN hide_contact = 1 THEN NULL ELSE contact END as contact
    FROM users 
    ORDER BY created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Update Profile including name (username) and full_name
app.put('/api/me', requireLogin, (req, res) => {
    const {name, full_name, grade, interests, skills, contact, hide_contact} = req.body;
    
    // Check if new username (name) is taken (only if changed)
    if (name && name !== req.user.name) {
        db.get(`SELECT id FROM users WHERE name = ?`, [name], (err, existing) => {
             if (existing) {
                 return res.status(409).json({error: 'Benutzername bereits vergeben'});
             }
             performUpdate();
        });
    } else {
        performUpdate();
    }

    function performUpdate() {
        const sql = `UPDATE users SET name = ?, full_name = ?, grade = ?, interests = ?, skills = ?, contact = ?, hide_contact = ? WHERE id = ?`;
        // if name is not provided, keep old name
        const newName = name || req.user.name;
        db.run(sql, [newName, full_name, grade, interests, skills, contact, hide_contact ? 1 : 0, req.user.id], function(err) {
            if (err) return res.status(500).json({error: err.message});
            
            // Return fresh user object
            db.get(`SELECT id, name, full_name, grade, interests, skills, contact, hide_contact, is_admin FROM users WHERE id = ?`, [req.user.id], (e, row) => {
                 res.json(row);
            });
        });
    }
});

// Updated to use full_name
app.get('/api/search', apiLimiter, requireLogin, (req, res) => {
  const {q} = req.query;
  const sql = `
    SELECT l.*, COALESCE(u.full_name, u.name) as author_name,
    CASE WHEN u.hide_contact = 1 THEN NULL ELSE u.contact END as contact
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
