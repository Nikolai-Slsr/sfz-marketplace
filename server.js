const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8081;

// Master-Passwort für Admin-Zugang
const MASTER_PASSWORD = process.env.SFZ_PASSWORD || 'sfz2024';

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 Minuten
  max: 50, // max 50 Requests pro IP
  message: {error: 'Zu viele Anfragen. Bitte später versuchen.'}
});

// Strikteres Limit für Auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {error: 'Zu viele Login-Versuche.'}
});

app.use(bodyParser.json({limit: '10mb'}));
app.use(express.static('public'));

// Auth-Middleware
function requireAuth(req, res, next) {
  const auth = req.headers['x-sfz-auth'];
  if (auth !== MASTER_PASSWORD) {
    return res.status(401).json({error: 'Ungültiges Passwort'});
  }
  next();
}

// Admin-Middleware
function requireAdmin(req, res, next) {
  const auth = req.headers['x-admin-auth'];
  if (auth !== 'admin-' + MASTER_PASSWORD) {
    return res.status(403).json({error: 'Kein Admin-Zugang'});
  }
  next();
}

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

// Auth-Routen
app.post('/api/auth', authLimiter, (req, res) => {
  const {password} = req.body;
  if (password === MASTER_PASSWORD) {
    res.json({success: true, token: MASTER_PASSWORD, admin: false});
  } else if (password === 'admin-' + MASTER_PASSWORD) {
    res.json({success: true, token: MASTER_PASSWORD, admin: true});
  } else {
    res.status(401).json({success: false, error: 'Falsches Passwort'});
  }
});

// User mit Passwort erstellen
app.post('/api/users', authLimiter, (req, res) => {
  const {name, grade, interests, skills, contact, password} = req.body;
  const password_hash = password ? bcrypt.hashSync(password, 10) : null;
  
  const sql = `INSERT INTO users (name, grade, interests, skills, contact, password_hash) VALUES (?,?,?,?,?,?)`;
  db.run(sql, [name, grade, interests, skills, contact, password_hash], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({id: this.lastID, name, grade, interests, skills, contact});
  });
});

// User Login mit Passwort
app.post('/api/users/login', authLimiter, (req, res) => {
  const {name, password} = req.body;
  db.get(`SELECT * FROM users WHERE name = ?`, [name], (err, user) => {
    if (err || !user) return res.status(401).json({error: 'User nicht gefunden'});
    if (!user.password_hash) return res.status(401).json({error: 'Kein Passwort gesetzt'});
    
    if (bcrypt.compareSync(password, user.password_hash)) {
      res.json({
        id: user.id,
        name: user.name,
        grade: user.grade,
        interests: user.interests,
        skills: user.skills,
        contact: user.contact,
        is_admin: user.is_admin == 1
      });
    } else {
      res.status(401).json({error: 'Falsches Passwort'});
    }
  });
});

// Alle Listenings (öffentlich)
app.get('/api/listings', apiLimiter, (req, res) => {
  const sql = `
    SELECT l.*, u.name as author_name, u.grade, u.interests, u.contact as author_contact
    FROM listings l 
    JOIN users u ON l.user_id = u.id 
    ORDER BY l.created_at DESC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Listings eines bestimmten Users
app.get('/api/users/:id/listings', apiLimiter, (req, res) => {
  const userId = req.params.id;
  db.all(`SELECT * FROM listings WHERE user_id = ? ORDER BY created_at DESC`, [userId], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Discover
app.get('/api/discover', apiLimiter, (req, res) => {
  let sql = `
    SELECT l.*, u.name as author_name, u.grade, u.interests, u.skills
    FROM listings l 
    JOIN users u ON l.user_id = u.id
    ORDER BY RANDOM() LIMIT 5
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Match
app.get('/api/match/:userId', apiLimiter, (req, res) => {
  const userId = req.params.userId;
  db.get(`SELECT interests, skills FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err || !user) return res.status(404).json({error: 'User not found'});
    
    const keywords = (user.interests + ' ' + user.skills).toLowerCase().split(/[,\s]+/);
    
    db.all(`SELECT l.*, u.name as author_name FROM listings l JOIN users u ON l.user_id = u.id WHERE l.user_id != ?`, [userId], (err, rows) => {
      if (err) return res.status(500).json({error: err.message});
      
      const scored = rows.map(row => {
        const text = (row.title + ' ' + row.description + ' ' + row.tags).toLowerCase();
        let score = 0;
        keywords.forEach(kw => { if (text.includes(kw)) score++; });
        return {...row, score};
      });
      
      res.json(scored.filter(r => r.score > 0).sort((a,b) => b.score - a.score).slice(0, 5));
    });
  });
});

// Bild-Upload Setup
const upload = multer({
  dest: 'public/uploads/',
  limits: {fileSize: 5 * 1024 * 1024}, // 5MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Nur Bilder erlaubt'));
    }
  }
});

// Upload-Verzeichnis erstellen
if (!fs.existsSync('public/uploads')) {
  fs.mkdirSync('public/uploads', {recursive: true});
}

// Listing erstellen (mit Bild)
app.post('/api/listings', requireAuth, upload.single('image'), (req, res) => {
  const {user_id, title, description, category, tags, type, price, vb} = req.body;
  const image_path = req.file ? '/uploads/' + req.file.filename : null;
  
  const sql = `INSERT INTO listings (user_id, title, description, category, tags, type, price, vb, image_path) VALUES (?,?,?,?,?,?,?,?,?)`;
  db.run(sql, [user_id, title, description, category, tags, type, price || '', vb ? 1 : 0, image_path], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({id: this.lastID, image_path});
  });
});

// Listing bearbeiten
app.put('/api/listings/:id', requireAuth, (req, res) => {
  const listingId = req.params.id;
  const {title, description, category, tags, price, vb} = req.body;
  
  const sql = `UPDATE listings SET title=?, description=?, category=?, tags=?, price=?, vb=? WHERE id=?`;
  db.run(sql, [title, description, category, tags, price, vb ? 1 : 0, listingId], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({updated: this.changes});
  });
});

// Listing löschen
app.delete('/api/listings/:id', requireAuth, (req, res) => {
  const listingId = req.params.id;
  
  // Optional: Bild auch löschen
  db.get(`SELECT image_path FROM listings WHERE id = ?`, [listingId], (err, row) => {
    if (row && row.image_path) {
      const imgPath = path.join(__dirname, 'public', row.image_path);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
  });
  
  db.run(`DELETE FROM listings WHERE id = ?`, [listingId], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({deleted: this.changes});
  });
});

// User-Liste (ohne Passwort-Hashes)
app.get('/api/users', apiLimiter, (req, res) => {
  db.all(`SELECT id, name, grade, interests, skills, is_admin, created_at FROM users ORDER BY created_at DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({error: err.message});
    res.json(rows);
  });
});

// Search
app.get('/api/search', apiLimiter, (req, res) => {
  const {q} = req.query;
  const sql = `
    SELECT l.*, u.name as author_name, u.contact as author_contact 
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

// Bug Reports
app.get('/api/bugs', requireAdmin, (req, res) => {
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

// Bug Status ändern (Admin)
app.put('/api/bugs/:id', requireAdmin, (req, res) => {
  const {status} = req.body;
  db.run(`UPDATE bugs SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({error: err.message});
    res.json({updated: this.changes});
  });
});

// Stats für Admin
app.get('/api/admin/stats', requireAdmin, (req, res) => {
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
