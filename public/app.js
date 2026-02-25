// SFZ Marktplatz - Komplett-Reset & Upgrade
let currentUser = JSON.parse(localStorage.getItem('sfz_user') || 'null');
let allListings = [];
let allUsers = [];

// --- HELPER ---
function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCategoryBadge(category, customStyle = '') {
    if (!category) return '';
    const cat = category.toLowerCase();
    let icon = 'tag';
    let colorClass = 'cat-default';

    if (cat.includes('technik') || cat.includes('robotik')) { icon = 'cpu'; colorClass = 'cat-technik'; }
    else if (cat.includes('naturwissenschaft')) { icon = 'flask-conical'; colorClass = 'cat-natur'; }
    else if (cat.includes('informatik') || cat.includes('coding')) { icon = 'code'; colorClass = 'cat-info'; }
    else if (cat.includes('kunst') || cat.includes('design')) { icon = 'palette'; colorClass = 'cat-kunst'; }
    else if (cat.includes('gesellschaft') || cat.includes('politik')) { icon = 'globe'; colorClass = 'cat-gesell'; }
    
    return `<span class="category-badge ${colorClass}" style="${customStyle}"><i data-lucide="${icon}" style="width:14px;height:14px"></i> ${escapeHtml(category)}</span>`;
}

function getTypeIcon(type) {
    const t = type.toLowerCase();
    if (t === 'angebot') return '<i data-lucide="tag" style="width:14px;height:14px"></i>';
    if (t === 'gesuch') return '<i data-lucide="search" style="width:14px;height:14px"></i>';
    if (t === 'projekt') return '<i data-lucide="rocket" style="width:14px;height:14px"></i>';
    return '<i data-lucide="bookmark" style="width:14px;height:14px"></i>';
}

function formatPrice(price, vb) {
    if (!price) return '';
    let p = escapeHtml(price);
    if (vb == 1 || vb === true) p += ' VB';
    return `<span style="color:var(--primary);font-weight:600">${p}</span>`;
}

// --- INIT ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAuth();
    setupEventListeners();
    loadData();
    if (window.lucide) lucide.createIcons();
});

function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (!view) return;
            if (!currentUser) {
                document.getElementById('authModal').classList.add('active');
                return;
            }
            switchView(view);
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            if (!btn.classList.contains('primary')) btn.classList.add('active');
        });
    });
}

function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(view).classList.add('active');

    if (view === 'listings') {
        const grid = document.getElementById('listingsGrid');
        if (!grid.innerHTML) renderListings('all');
    }
    if (view === 'people') renderPeople();
    if (view === 'discover') loadDiscovery();
    if (view === 'account') loadAccount();
}

async function initAuth() {
    const userMenu = document.getElementById('userMenu');
    if (currentUser) {
        const res = await fetch('/api/me').catch(() => null);
        if (!res || !res.ok) {
            currentUser = null;
            localStorage.removeItem('sfz_user');
        } else {
            const fresh = await res.json();
            currentUser = fresh;
            localStorage.setItem('sfz_user', JSON.stringify(fresh));
            const displayName = escapeHtml(currentUser.full_name || currentUser.name);
            userMenu.innerHTML = `
                <span>Hallo, <strong>${displayName}</strong></span>
                <button onclick="logout()" class="nav-btn">Abmelden</button>
            `;
            document.getElementById('matchCard').style.display = 'block';
            document.getElementById('accountBtn').style.display = 'inline-flex';
            document.getElementById('welcomeTitle').innerText = 'Moin, ' + displayName.split(' ')[0] + '!';
            document.getElementById('welcomeText').innerText = 'Schön, dass du da bist. Hier ist dein Update.';
            document.getElementById('quickActions').style.display = 'flex';
            if (window.lucide) lucide.createIcons();
            return;
        }
    }
    userMenu.innerHTML = `<button id="loginBtn" class="nav-btn">Login</button>`;
    document.getElementById('loginBtn').addEventListener('click', () => {
        document.getElementById('authModal').classList.add('active');
    });
}

function logout() {
    fetch('/api/logout', {method: 'POST'}).finally(() => {
        currentUser = null;
        localStorage.removeItem('sfz_user');
        location.reload();
    });
}

// --- API ---
async function apiCall(url, method = 'POST', data = null) {
    const options = { method, headers: {'Content-Type': 'application/json'} };
    if (data) options.body = JSON.stringify(data);
    return fetch(url, options);
}

async function apiPost(url, data) { return apiCall(url, 'POST', data); }

async function loadData() {
    try {
        if (!currentUser) {
            const hint = document.getElementById('loginHint');
            if (hint) hint.style.display = 'block';
            return;
        }
        const [listingsRes, usersRes] = await Promise.all([ fetch('/api/listings'), fetch('/api/users') ]);
        if (!listingsRes.ok || !usersRes.ok) {
            currentUser = null;
            localStorage.removeItem('sfz_user');
            document.getElementById('authModal').classList.add('active');
            return;
        }
        allListings = await listingsRes.json();
        allUsers = await usersRes.json();
        loadDiscovery();
    } catch (err) { console.error('Error loading data:', err); }
}

async function loadDiscovery() {
    if (!currentUser) return;
    await loadRandom();
    await loadMatches();
    renderActiveUsers();
    if (window.lucide) lucide.createIcons();
}

async function loadRandom() {
    try {
        const res = await fetch('/api/discover');
        const items = await res.json();
        items.forEach(r => { if (!allListings.find(l => l.id === r.id)) allListings.push(r); });
        const container = document.getElementById('randomListings');
        container.innerHTML = items.map(item => {
            const imgs = item.image_paths ? JSON.parse(item.image_paths) : [];
            const bg = imgs.length > 0 ? `background-image:url(${imgs[0]})` : '';
            return `
            <div class="mini-card" onclick="showDetail(${item.id})">
                <div class="mini-img" style="${bg}; ${!imgs.length ? 'background:var(--border);display:flex;align-items:center;justify-content:center;' : ''}">
                    ${!imgs.length ? '<i data-lucide="package"></i>' : ''}
                </div>
                <div class="mini-content">
                    <h4>${escapeHtml(item.title)}</h4>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
                        ${getCategoryBadge(item.category, "font-size:0.7rem;padding:2px 8px")}
                        <span style="font-size:0.75rem;color:var(--text-light)">• ${new Date(item.created_at).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    } catch (err) { console.error(err); }
}

async function loadMatches() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/match/${currentUser.id}`);
        const items = await res.json();
        items.forEach(r => { if (!allListings.find(l => l.id === r.id)) allListings.push(r); });
        const container = document.getElementById('matchListings');
        if (items.length === 0) {
            container.innerHTML = '<p style="color:var(--text-light)">Noch keine passenden Anzeigen gefunden.</p>';
            return;
        }
        container.innerHTML = items.map(item => `
            <div class="mini-card" onclick="showDetail(${item.id})">
                <div class="mini-content">
                    <h4>${escapeHtml(item.title)}</h4>
                    <div class="meta" style="color:#059669;font-weight:600">${item.score} gemeinsame Tags</div>
                </div>
            </div>`).join('');
    } catch (err) { console.error(err); }
}

function renderActiveUsers() {
    const container = document.getElementById('activeUsers');
    container.innerHTML = allUsers.slice(0, 8).map(user => `
        <span class="user-chip" onclick="showUserProfile(${user.id})">${escapeHtml(user.full_name || user.name)}</span>
    `).join('');
}

// --- RENDERING ---
function renderImages(item, large=false){
    try {
        const imgs = item.image_paths ? JSON.parse(item.image_paths) : (item.image_path ? [item.image_path] : []);
        if (!imgs || imgs.length === 0) return '';
        if (large) {
            return `<div class="detail-image-grid">${imgs.map(src => `<img src="${src}" class="detail-img" alt="Bild" onclick="openLightbox('${src}')">`).join('')}</div>`;
        } else {
            return `<div class="card-image-wrapper"><img src="${imgs[0]}" class="card-img" alt="Cover">${imgs.length > 1 ? `<div class="img-badge">+${imgs.length - 1}</div>` : ''}</div>`;
        }
    } catch { return ''; }
}

function renderListings(filter) {
    const container = document.getElementById('listingsGrid');
    let filtered = allListings;
    if (filter !== 'all') filtered = allListings.filter(l => l.type === filter || l.category === filter);

    container.innerHTML = filtered.map(item => `
        <div class="card" onclick="showDetail(${item.id})">
            <div class="card-header">
                <span class="card-type ${item.type}">${getTypeIcon(item.type)} ${escapeHtml(item.type)}</span>
                ${getCategoryBadge(item.category, "margin-left:auto")}
            </div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description?.substring(0, 100))}...</p>
            ${renderImages(item)}
            <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
            <div class="card-footer">
                <span style="display:flex;align-items:center;gap:4px"><i data-lucide="user" style="width:12px;height:12px"></i> ${escapeHtml(item.author_name)}</span>
                <span>${new Date(item.created_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

function renderPeople() {
    const container = document.getElementById('peopleGrid');
    container.innerHTML = allUsers.map(user => {
        const displayName = escapeHtml(user.full_name || user.name);
        const skillList = (user.interests || user.skills || '').split(',').map(s => s.trim()).filter(s => s.length > 0);
        const topSkills = skillList.slice(0, 2);
        return `
            <div class="person-card" onclick="showUserProfile(${user.id})">
                <div class="person-avatar">${displayName.charAt(0).toUpperCase()}</div>
                <div class="person-grade-badge">${escapeHtml(user.grade) || 'Mitglied'}</div>
                <h3 style="margin: 0 0 6px 0; font-size: 1.1rem; color: var(--text)">${displayName}</h3>
                <div class="person-skill-tags">
                    ${topSkills.map(s => `<span class="mini-skill-tag">${escapeHtml(s)}</span>`).join('')}
                    ${skillList.length > 2 ? `<span class="mini-skill-tag" style="opacity:0.6">+${skillList.length - 2}</span>` : ''}
                </div>
                <div style="margin-top:auto; padding-top:20px; width:100%">
                    <button class="btn-secondary" style="width:100%; font-size:0.8rem; padding:10px; border-radius:10px; border-color:var(--border); font-weight:600">
                        Profil öffnen
                    </button>
                </div>
            </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
}

// --- MODALS ---
function showDetail(id) {
    const item = allListings.find(l => l.id === id);
    if (!item) return;
    const priceDisplay = item.price ? `
        <div class="detail-price-box">
            <div style="font-size:0.75rem; opacity:0.9; text-transform:uppercase; font-weight:700; margin-bottom:4px">Preisansatz</div>
            <div style="font-size:2rem; font-weight:800">${escapeHtml(item.price)}${item.vb == 1 ? ' <span style="font-size:1.1rem; opacity:0.8">VB</span>' : ''}</div>
        </div>` : '';

    const content = document.getElementById('detailContent');
    content.innerHTML = `
        <div class="detail-container">
            <div class="detail-main">
                <div style="margin-bottom:24px; display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
                    ${getCategoryBadge(item.category)}
                    <span class="card-type ${item.type}" style="margin:0">${escapeHtml(item.type)}</span>
                    <span style="color:var(--text-light); font-size:0.85rem; margin-left:auto; display:flex; align-items:center; gap:4px">
                        <i data-lucide="calendar" style="width:14px;height:14px"></i> ${new Date(item.created_at).toLocaleDateString()}
                    </span>
                </div>
                <h1 style="font-size:2.25rem; margin-bottom:24px; color:var(--text); line-height:1.1; font-weight:800">${escapeHtml(item.title)}</h1>
                <div style="background:white; border:1px solid var(--border); border-radius:16px; padding:28px; margin-bottom:28px; line-height:1.8; color:var(--text); font-size:1.05rem;">
                    ${escapeHtml(item.description).replace(/\n/g, '<br>')}
                </div>
                ${renderImages(item, true)}
                <div class="tags" style="margin-top:32px; padding-top:24px; border-top:1px solid var(--border)">
                    ${item.tags?.split(',').map(t => `<span class="tag" style="padding:8px 14px; font-size:0.85rem; background:white; border:1px solid var(--border)">#${escapeHtml(t.trim())}</span>`).join('') || ''}
                </div>
            </div>
            <div class="detail-sidebar">
                ${priceDisplay}
                <div class="detail-author-card">
                    <div style="font-size:0.75rem; color:var(--text-light); font-weight:700; text-transform:uppercase; margin-bottom:20px">Anbieter</div>
                    <div style="display:flex; align-items:center; gap:16px; margin-bottom:24px">
                        <div class="person-avatar" style="width:56px; height:56px; font-size:1.5rem; margin:0">${escapeHtml(item.author_name).charAt(0).toUpperCase()}</div>
                        <div>
                            <div style="font-weight:700; color:var(--text); font-size:1.1rem">${escapeHtml(item.author_name)}</div>
                            <div style="font-size:0.9rem; color:var(--text-light)">${escapeHtml(item.grade) || 'SFZ Mitglied'}</div>
                        </div>
                    </div>
                    <button onclick="showUserProfile(${item.user_id})" class="btn-secondary" style="width:100%; justify-content:center; gap:8px; font-weight:600">
                        <i data-lucide="user-search" style="width:18px;height:18px"></i> Profil ansehen
                    </button>
                </div>
                <div class="detail-contact-box">
                    <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; margin-bottom:12px; display:flex; align-items:center; gap:8px">
                        <i data-lucide="message-square" style="width:16px;height:16px"></i> Kontaktweg
                    </div>
                    <div style="font-size:1.15rem; font-weight:700; word-break:break-word">
                        ${escapeHtml(item.contact) || '<em style="opacity:0.6; font-weight:normal; font-size:0.9rem">Privat</em>'}
                    </div>
                </div>
                <button onclick="document.getElementById('detailModal').classList.remove('active')" class="btn-secondary" style="width:100%; justify-content:center; margin-top:auto; background:white; color:var(--text-light)">Schließen</button>
            </div>
        </div>
    `;
    document.getElementById('detailModal').classList.add('active');
    if (window.lucide) lucide.createIcons();
}

function showUserProfile(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    const displayName = escapeHtml(user.full_name || user.name);

    const content = document.getElementById('detailContent');
    content.innerHTML = `
        <div style="padding: 40px; min-height: 80vh;">
            <!-- Header Section -->
            <div style="text-align:center; margin-bottom:40px; padding-bottom:40px; border-bottom:1px solid var(--border)">
                <div class="person-avatar" style="width:110px; height:110px; font-size:2.8rem; margin:0 auto 24px; box-shadow:var(--shadow-lg); background:linear-gradient(135deg, var(--primary), var(--secondary)); color:white; border:4px solid white; outline:1px solid var(--border)">
                    ${displayName.charAt(0).toUpperCase()}
                </div>
                <h2 style="font-size:2.5rem; margin-bottom:12px; color:var(--text); font-weight:800; letter-spacing:-1px; line-height:1">${displayName}</h2>
                <div style="display:inline-flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:center;">
                    <span style="background:var(--bg); border:1px solid var(--border); padding:5px 14px; border-radius:20px; font-size:0.9rem; font-family:monospace; color:var(--text-light); font-weight:600">@${escapeHtml(user.username || user.name)}</span>
                    <span style="color:var(--primary); font-weight:800; font-size:1.1rem; display:flex; align-items:center; gap:6px">
                        <i data-lucide="shield-check" style="width:18px;height:18px"></i>
                        ${escapeHtml(user.grade) || 'SFZ Mitglied'}
                    </span>
                </div>
            </div>
            
            <!-- Info Cards Grid -->
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:32px; margin-bottom:48px;">
                <div style="background:var(--bg); padding:32px; border-radius:28px; border:1px solid var(--border); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02)">
                    <div style="font-size:0.8rem; color:var(--text-light); font-weight:800; text-transform:uppercase; margin-bottom:20px; display:flex; align-items:center; gap:12px; letter-spacing:1px">
                        <div style="width:32px; height:32px; border-radius:10px; background:white; display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow)">
                            <i data-lucide="heart" style="width:18px;height:18px; color:var(--primary)"></i>
                        </div>
                        Interessen & Themen
                    </div>
                    <p style="margin:0; line-height:1.8; color:var(--text); font-size:1.15rem; font-weight:500">${escapeHtml(user.interests) || '<em style="color:var(--text-light); font-weight:400">Keine Interessen hinterlegt</em>'}</p>
                </div>
                
                <div style="background:var(--bg); padding:32px; border-radius:28px; border:1px solid var(--border); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02)">
                    <div style="font-size:0.8rem; color:var(--text-light); font-weight:800; text-transform:uppercase; margin-bottom:20px; display:flex; align-items:center; gap:12px; letter-spacing:1px">
                        <div style="width:32px; height:32px; border-radius:10px; background:white; display:flex; align-items:center; justify-content:center; box-shadow:var(--shadow)">
                            <i data-lucide="zap" style="width:18px;height:18px; color:var(--accent)"></i>
                        </div>
                        Skills & Wissen
                    </div>
                    <p style="margin:0; line-height:1.8; color:var(--text); font-size:1.15rem; font-weight:500">${escapeHtml(user.skills) || '<em style="color:var(--text-light); font-weight:400">Keine Skills hinterlegt</em>'}</p>
                </div>
            </div>

            <!-- Contact Hero Section -->
            <div style="background:linear-gradient(135deg, var(--primary), var(--secondary)); color:white; padding:48px; border-radius:32px; box-shadow:var(--shadow-lg); text-align:center; position:relative; overflow:hidden; border:1px solid rgba(255,255,255,0.1)">
                <!-- Glassmorphism Orbs -->
                <div style="position:absolute; top:-30%; right:-10%; width:250px; height:250px; background:white; opacity:0.1; border-radius:50%; filter:blur(40px)"></div>
                <div style="position:absolute; bottom:-20%; left:-5%; width:150px; height:150px; background:white; opacity:0.15; border-radius:50%; filter:blur(30px)"></div>
                
                <div style="font-size:0.9rem; opacity:0.9; font-weight:800; text-transform:uppercase; margin-bottom:20px; letter-spacing:2px; display:flex; align-items:center; justify-content:center; gap:12px">
                    <i data-lucide="message-circle" style="width:24px;height:24px"></i> Nachricht schreiben
                </div>
                <div style="font-size:2rem; font-weight:900; letter-spacing:-0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.1)">
                    ${escapeHtml(user.contact) || '<span style="opacity:0.7; font-weight:400; font-size:1.2rem">Kontaktweg nicht öffentlich</span>'}
                </div>
            </div>
            
            <div style="margin-top:48px; display:flex; justify-content:center;">
                <button onclick="document.getElementById('detailModal').classList.remove('active')" class="btn-secondary" style="background:white; border:1px solid var(--border); color:var(--text-light); padding:12px 32px; border-radius:14px; font-weight:600; font-size:0.95rem; transition:all 0.2s">
                    Fenster schließen
                </button>
            </div>
        </div>
    `;
    document.getElementById('detailModal').classList.add('active');
    if (window.lucide) lucide.createIcons();
}

function openLightbox(src) {
    document.getElementById('lightboxImage').src = src;
    document.getElementById('lightboxModal').classList.add('active');
}

// --- ACCOUNT ---
async function loadAccount() {
    if (!currentUser) return;
    const container = document.getElementById('accountInfo');
    const hiddenBadge = (currentUser.hide_contact === 1 || currentUser.hide_contact === true)
        ? ' <span style="font-size:0.8rem;color:var(--text-light);background:var(--bg);padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:4px"><i data-lucide="lock" style="width:12px;height:12px"></i> Verborgen</span>' : '';
    const displayName = escapeHtml(currentUser.full_name || currentUser.name);
    
    container.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:center; margin-bottom:24px; padding-bottom:24px; border-bottom:1px solid var(--border)">
            <div class="person-avatar" style="width:80px; height:80px; font-size:2rem; margin:0; flex-shrink:0;">${displayName.charAt(0).toUpperCase()}</div>
            <div style="flex:1; min-width:200px;">
                <h2 style="margin:0 0 4px 0; font-size:1.5rem;">${displayName}</h2>
                <p style="color:var(--text-light); margin:0; display:flex; align-items:center; gap:8px;">
                    <span style="background:var(--bg); border:1px solid var(--border); padding:2px 8px; border-radius:12px; font-size:0.8rem; font-family:monospace;">@${escapeHtml(currentUser.name)}</span>
                    ${escapeHtml(currentUser.grade) || 'SFZ Mitglied'}
                </p>
            </div>
            <button onclick="startProfileEdit()" class="btn-primary" style="display:flex; align-items:center; gap:8px; white-space:nowrap; padding:10px 20px;">
                <i data-lucide="edit-3" style="width:16px;height:16px"></i> Profil bearbeiten
            </button>
        </div>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:24px;">
            <div style="background:var(--bg); padding:16px; border-radius:12px; border:1px solid var(--border);">
                <div style="font-size:0.8rem; color:var(--text-light); font-weight:700; text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="heart" style="width:14px;height:14px; color:var(--primary)"></i> Interessen
                </div>
                <p style="margin:0; line-height:1.5; color:var(--text); font-size:0.95rem;">${escapeHtml(currentUser.interests) || '<em>Keine angegeben</em>'}</p>
            </div>
            <div style="background:var(--bg); padding:16px; border-radius:12px; border:1px solid var(--border);">
                <div style="font-size:0.8rem; color:var(--text-light); font-weight:700; text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="zap" style="width:14px;height:14px; color:var(--accent)"></i> Skills
                </div>
                <p style="margin:0; line-height:1.5; color:var(--text); font-size:0.95rem;">${escapeHtml(currentUser.skills) || '<em>Keine angegeben</em>'}</p>
            </div>
            <div style="background:var(--bg); padding:16px; border-radius:12px; border:1px solid var(--border);">
                <div style="font-size:0.8rem; color:var(--text-light); font-weight:700; text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="mail" style="width:14px;height:14px; color:var(--secondary)"></i> Kontakt
                </div>
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                    <p style="margin:0; color:var(--text); font-size:0.95rem;">${escapeHtml(currentUser.contact) || '<em>Keine angegeben</em>'}</p>
                    ${hiddenBadge}
                </div>
            </div>
        </div>
    `;

    try {
        const res = await fetch(`/api/users/${currentUser.id}/listings`);
        const items = await res.json();
        items.forEach(r => { if (!allListings.find(l => l.id === r.id)) allListings.push(r); });
        document.getElementById('myListings').innerHTML = items.map(item => `
            <div class="card">
                <div class="card-header">
                    <span class="card-type ${item.type}">${getTypeIcon(item.type)} ${escapeHtml(item.type)}</span>
                    ${getCategoryBadge(item.category, "margin-left:auto")}
                    <div class="card-actions">
                        <button class="action-btn" onclick="event.stopPropagation(); startEdit(${item.id})"><i data-lucide="pencil" style="width:16px;height:16px"></i></button>
                        <button class="action-btn delete" onclick="event.stopPropagation(); deleteListing(${item.id})"><i data-lucide="trash-2" style="width:16px;height:16px"></i></button>
                    </div>
                </div>
                <h3>${escapeHtml(item.title)}</h3>
                ${renderImages(item)}
                <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
            </div>`).join('') || '<p style="color:var(--text-light)">Noch keine Anzeigen.</p>';
    } catch (err) { console.error(err); }
    if (window.lucide) lucide.createIcons();
}

function startProfileEdit() {
    if (!currentUser) return;
    document.getElementById('profName').value = currentUser.name || '';
    document.getElementById('profFullName').value = currentUser.full_name || '';
    document.getElementById('profGrade').value = currentUser.grade || '';
    document.getElementById('profInterests').value = currentUser.interests || '';
    document.getElementById('profSkills').value = currentUser.skills || '';
    document.getElementById('profContact').value = currentUser.contact || '';
    document.getElementById('profHideContact').checked = (currentUser.hide_contact === 1 || currentUser.hide_contact === true);
    document.getElementById('editProfileModal').classList.add('active');
}

async function saveProfile(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('profName').value,
        full_name: document.getElementById('profFullName').value,
        grade: document.getElementById('profGrade').value,
        interests: document.getElementById('profInterests').value,
        skills: document.getElementById('profSkills').value,
        contact: document.getElementById('profContact').value,
        hide_contact: document.getElementById('profHideContact').checked
    };
    try {
        const res = await apiCall('/api/me', 'PUT', data);
        if (res.ok) {
            currentUser = await res.json();
            localStorage.setItem('sfz_user', JSON.stringify(currentUser));
            document.getElementById('editProfileModal').classList.remove('active');
            loadAccount(); loadData();
        } else { const err = await res.json(); alert(err.error); }
    } catch (err) { console.error(err); }
}

async function deleteListing(id) {
    if (!confirm('Anzeige wirklich löschen?')) return;
    try {
        const res = await apiCall(`/api/listings/${id}`, 'DELETE');
        if (res.ok) { loadAccount(); loadData(); }
    } catch (err) { console.error(err); }
}

function startEdit(id) {
    const item = allListings.find(l => l.id === id);
    if (!item) return;
    document.getElementById('editId').value = item.id;
    document.getElementById('editTitle').value = item.title;
    document.getElementById('editType').value = item.type;
    document.getElementById('editCategory').value = item.category;
    document.getElementById('editDescription').value = item.description;
    document.getElementById('editPrice').value = item.price;
    document.getElementById('editVb').checked = item.vb == 1;
    document.getElementById('editTags').value = item.tags;
    document.getElementById('editModal').classList.add('active');
}

async function saveEdit(e) {
    e.preventDefault();
    const id = document.getElementById('editId').value;
    const data = {
        title: document.getElementById('editTitle').value,
        type: document.getElementById('editType').value,
        category: document.getElementById('editCategory').value,
        description: document.getElementById('editDescription').value,
        price: document.getElementById('editPrice').value,
        vb: document.getElementById('editVb').checked,
        tags: document.getElementById('editTags').value
    };
    try {
        const res = await apiCall(`/api/listings/${id}`, 'PUT', data);
        if (res.ok) { document.getElementById('editModal').classList.remove('active'); loadAccount(); loadData(); }
    } catch (err) { console.error(err); }
}

// --- SEARCH ---
async function doSearch() {
    const q = document.getElementById('searchInput').value;
    if (!currentUser) { document.getElementById('authModal').classList.add('active'); return; }
    if (!q) return;
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();
        results.forEach(r => { if (!allListings.find(l => l.id === r.id)) allListings.push(r); });
        switchView('listings');
        const container = document.getElementById('listingsGrid');
        if (results.length === 0) {
            container.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-light)">Keine Ergebnisse.</p>';
            return;
        }
        container.innerHTML = results.map(item => `
            <div class="card" onclick="showDetail(${item.id})">
                <div class="card-header">
                    <span class="card-type ${item.type}">${getTypeIcon(item.type)} ${escapeHtml(item.type)}</span>
                    ${getCategoryBadge(item.category)}
                </div>
                <h3>${escapeHtml(item.title)}</h3>
                ${renderImages(item)}
                <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
                <div class="card-footer"><span>${escapeHtml(item.author_name)}</span><span>🔍 Suchtreffer</span></div>
            </div>`).join('');
        if (window.lucide) lucide.createIcons();
    } catch (err) { console.error(err); }
}

// --- BUG / AUTH / ETC ---
async function submitBug(e) {
    e.preventDefault();
    const data = {
        category: document.getElementById('bugCategory').value,
        title: document.getElementById('bugTitle').value,
        description: document.getElementById('bugDesc').value,
        reporter: document.getElementById('bugReporter').value || 'Anonymous'
    };
    try {
        const res = await apiCall('/api/bugs', 'POST', data);
        if (res.ok) {
            document.getElementById('bugForm').reset();
            document.getElementById('bugSuccess').style.display = 'block';
            setTimeout(() => { document.getElementById('bugModal').classList.remove('active'); document.getElementById('bugSuccess').style.display = 'none'; }, 2000);
        }
    } catch (err) { console.error(err); }
}

async function doLogin(e) {
    e.preventDefault();
    const name = document.getElementById('loginName').value;
    const password = document.getElementById('loginPassword').value;
    try {
        const res = await apiPost('/api/login', {name, password});
        if (!res.ok) { document.getElementById('authError').style.display = 'block'; return; }
        currentUser = await res.json();
        localStorage.setItem('sfz_user', JSON.stringify(currentUser));
        location.reload();
    } catch (err) { console.error(err); }
}

async function doRegister(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('regName').value,
        full_name: document.getElementById('regFullName').value,
        password: document.getElementById('regPassword').value,
        grade: document.getElementById('regGrade').value,
        interests: document.getElementById('regInterests').value,
        skills: document.getElementById('regSkills').value,
        contact: document.getElementById('regContact').value,
        inviteCode: document.getElementById('regInvite').value
    };
    try {
        const res = await apiPost('/api/register', data);
        if (!res.ok) { const err = await res.json(); document.getElementById('authError').textContent = err.error; document.getElementById('authError').style.display = 'block'; return; }
        currentUser = await res.json();
        localStorage.setItem('sfz_user', JSON.stringify(currentUser));
        location.reload();
    } catch (err) { console.error(err); }
}

function setupEventListeners() {
    const quickCreate = document.getElementById('quickCreate');
    if (quickCreate) quickCreate.addEventListener('click', () => switchView('create'));

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderListings(btn.dataset.filter);
        });
    });

    document.getElementById('searchBtn').addEventListener('click', doSearch);
    document.getElementById('searchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') doSearch(); });
    document.getElementById('authForm').addEventListener('submit', doLogin);
    document.getElementById('registerForm').addEventListener('submit', doRegister);
    document.getElementById('createForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = new FormData();
        data.append('title', document.getElementById('title').value);
        data.append('type', document.getElementById('type').value);
        data.append('category', document.getElementById('category').value);
        data.append('description', document.getElementById('description').value);
        data.append('tags', document.getElementById('tags').value);
        data.append('price', document.getElementById('price').value);
        data.append('vb', document.getElementById('vb').checked ? '1' : '0');
        const files = document.getElementById('image').files;
        for (const f of files) data.append('images', f);
        const res = await fetch('/api/listings', { method: 'POST', body: data });
        if (res.ok) { document.getElementById('createForm').reset(); switchView('listings'); loadData(); }
    });
    document.getElementById('bugForm').addEventListener('submit', submitBug);
    document.getElementById('editForm').addEventListener('submit', saveEdit);
    document.getElementById('editProfileForm').addEventListener('submit', saveProfile);
    document.getElementById('bugBtn').addEventListener('click', () => document.getElementById('bugModal').classList.add('active'));
    document.querySelectorAll('.close').forEach(btn => btn.addEventListener('click', () => btn.closest('.modal').classList.remove('active')));
    document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); }));
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
}
