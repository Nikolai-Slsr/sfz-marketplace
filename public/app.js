// SFZ Marktplatz - Frontend mit Login
let currentUser = JSON.parse(localStorage.getItem('sfz_user') || 'null');
let allListings = [];
let allUsers = [];

// Helper
function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


// Helper for Category Badges
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

// Init
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAuth();
    setupEventListeners();
    loadData();
    // Initialize icons if lucide is present
    if (window.lucide) lucide.createIcons();
});

function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (!view) return; // e.g. Bug button
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
        // Only render defaults if grid is empty (first load), otherwise keep current state
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
            // Prefer full_name for display, fallback to name
            const displayName = escapeHtml(currentUser.full_name || currentUser.name);
            userMenu.innerHTML = `
                <span>Hallo, <strong>${displayName}</strong></span>
                <button onclick="logout()" class="nav-btn">Abmelden</button>
            `;
            document.getElementById('matchCard').style.display = 'block';
            document.getElementById('matchListings').classList.add('mini-grid');
            document.getElementById('accountBtn').style.display = 'inline-flex'; // changed to flex for icon alignment
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

async function apiCall(url, method = 'POST', data = null) {
    const options = {
        method,
        headers: {'Content-Type': 'application/json'}
    };
    if (data) options.body = JSON.stringify(data);
    return fetch(url, options);
}

async function apiPost(url, data) {
    return apiCall(url, 'POST', data);
}

async function loadData() {
    try {
        if (!currentUser) {
        const hint = document.getElementById('loginHint');
        if (hint) hint.style.display = 'block';
        return;
    }
        const [listingsRes, usersRes] = await Promise.all([
            fetch('/api/listings'),
            fetch('/api/users')
        ]);
        if (!listingsRes.ok || !usersRes.ok) {
            currentUser = null;
            localStorage.removeItem('sfz_user');
            document.getElementById('authModal').classList.add('active');
            return;
        }
        allListings = await listingsRes.json();
        allUsers = await usersRes.json();
        loadDiscovery();
    } catch (err) {
        console.error('Error loading data:', err);
    }
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
        
        items.forEach(r => {
             // Keep merging in case of missing items
            if (!allListings.find(l => l.id === r.id)) allListings.push(r);
        });

        const container = document.getElementById('randomListings');
        
        container.innerHTML = items.map(item => {
            const parsedImages = item.image_paths ? JSON.parse(item.image_paths) : [];
            const hasImage = parsedImages.length > 0;
            const bg = hasImage ? `background-image:url(${parsedImages[0]})` : '';
            const fallback = !hasImage ? `background:var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-light)` : '';
            const fallbackContent = !hasImage ? '<i data-lucide="package"></i>' : '';

            return `
            <div class="mini-card" onclick="showDetail(${item.id})">
                <div class="mini-img" style="${bg};${fallback}">${fallbackContent}</div>
                <div class="mini-content">
                    <h4>${escapeHtml(item.title)}</h4>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:4px">${getCategoryBadge(item.category, "font-size:0.7rem;padding:2px 8px")} <span style="font-size:0.75rem;color:var(--text-light)">• ${new Date(item.created_at).toLocaleDateString()}</span></div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Error loading latest:', err);
    }
}

async function loadMatches() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/match/${currentUser.id}`);
        const items = await res.json();
        
        items.forEach(r => {
            if (!allListings.find(l => l.id === r.id)) allListings.push(r);
        });

        const container = document.getElementById('matchListings');
        if (items.length === 0) {
            container.innerHTML = '<p style="color: var(--text-light);">Noch keine passenden Anzeigen gefunden. Erstelle dein Profil mit Interessen!</p>';
            return;
        }
        container.innerHTML = items.map(item => {
            const parsedImages = item.image_paths ? JSON.parse(item.image_paths) : [];
            const hasImage = parsedImages.length > 0;
            const bg = hasImage ? `background-image:url(${parsedImages[0]})` : '';
            const fallback = !hasImage ? `background:var(--border);display:flex;align-items:center;justify-content:center;color:var(--text-light)` : '';
            const fallbackContent = !hasImage ? '<i data-lucide="zap"></i>' : '';

            return `
            <div class="mini-card" onclick="showDetail(${item.id})">
                <div class="mini-img" style="${bg};${fallback}">${fallbackContent}</div>
                <div class="mini-content">
                    <h4>${escapeHtml(item.title)}</h4>
                    <div class="meta" style="color:#059669;font-weight:600">${item.score} gemeinsame Tags</div>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('Error loading matches:', err);
    }
}

function renderActiveUsers() {
    const container = document.getElementById('activeUsers');
    container.innerHTML = allUsers.slice(0, 8).map(user => `
        <span class="user-chip" onclick="showUserProfile(${user.id})">${escapeHtml(user.full_name || user.name)}</span>
    `).join('');
}

function renderImages(item, large=false){
    try {
        const imgs = item.image_paths ? JSON.parse(item.image_paths) : (item.image_path ? [item.image_path] : []);
        if (!imgs || imgs.length === 0) return '';
        
        if (large) {
            return `
                <div class="detail-image-grid">
                    ${imgs.map(src => `<img src="${src}" class="detail-img" alt="Anzeigenbild" onclick="openLightbox('${src}')">`).join('')}
                </div>
            `;
        } else {
            const extraBadge = imgs.length > 1 ? `<div class="img-badge">+${imgs.length - 1}</div>` : '';
            return `
                <div class="card-image-wrapper">
                    <img src="${imgs[0]}" class="card-img" alt="Coverbild">
                    ${extraBadge}
                </div>
            `;
        }
    } catch { return ''; }
}

function formatPrice(price, vb) {
    if (!price) return '';
    let p = escapeHtml(price);
    if (vb == 1 || vb === true) p += ' VB';
    return `<span style="color:var(--primary);font-weight:600">${p}</span>`;
}

function filterCat(cat) {
    switchView('listings');
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.remove('active');
        if (b.dataset.filter === cat) b.classList.add('active');
    });
    renderListings(cat);
}

function renderListings(filter) {
    const container = document.getElementById('listingsGrid');
    let filtered = allListings;
    if (filter !== 'all') {
        filtered = allListings.filter(l => l.type === filter || l.category === filter);
    }

    container.innerHTML = filtered.map(item => `
        <div class="card" onclick="showDetail(${item.id})">
            <div class="card-header">
                <span class="card-type ${item.type}">${escapeHtml(item.type)}</span>
                ${getCategoryBadge(item.category, "margin-left:auto")}
            </div>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.description?.substring(0, 100))}...</p>
            ${renderImages(item)}
            <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
            <div class="tags">
                ${item.tags?.split(',').map(t => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('') || ''}
            </div>
            <div class="card-footer">
                <span>${escapeHtml(item.author_name)}</span>
                <span>${new Date(item.created_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

function renderPeople() {
    const container = document.getElementById('peopleGrid');
    container.innerHTML = allUsers.map(user => `
        <div class="person-card" onclick="showUserProfile(${user.id})">
            <div class="person-avatar">${escapeHtml((user.full_name || user.name).charAt(0).toUpperCase())}</div>
            <h3>${escapeHtml(user.full_name || user.name)}</h3>
            <div class="grade">${escapeHtml(user.grade)}</div>
            <div class="person-skills">
                ${escapeHtml(user.interests?.substring(0, 30))}...
            </div>
        </div>
    `).join('');
}

function setupEventListeners() {
    // Quick Actions
    const quickCreate = document.getElementById('quickCreate');
    if (quickCreate) quickCreate.addEventListener('click', () => {
        switchView('create');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    });

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderListings(btn.dataset.filter);
        });
    });

    document.getElementById('searchBtn').addEventListener('click', doSearch);
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSearch();
    });

    document.getElementById('authForm').addEventListener('submit', doLogin);
    document.getElementById('registerForm').addEventListener('submit', doRegister);
    document.getElementById('createForm').addEventListener('submit', createListing);
    document.getElementById('bugForm').addEventListener('submit', submitBug);
    document.getElementById('editForm').addEventListener('submit', saveEdit);
    const pfForm = document.getElementById('editProfileForm');
    if (pfForm) pfForm.addEventListener('submit', saveProfile);

    const bugBtn = document.getElementById('bugBtn');
    if (bugBtn) bugBtn.addEventListener('click', () => document.getElementById('bugModal').classList.add('active'));

    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.remove('active');
        });
    });

    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });

    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(tab).classList.add('active');
        });
    });
}

function openLightbox(src) {
    document.getElementById('lightboxImage').src = src;
    document.getElementById('lightboxModal').classList.add('active');
}

async function doLogin(e) {
    e.preventDefault();
    const name = document.getElementById('loginName').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await apiPost('/api/login', {name, password});
        if (!res.ok) {
            document.getElementById('authError').textContent = 'Login fehlgeschlagen.';
            document.getElementById('authError').style.display = 'block';
            return;
        }
        const user = await res.json();
        currentUser = user;
        localStorage.setItem('sfz_user', JSON.stringify(user));
        document.getElementById('authModal').classList.remove('active');
        document.getElementById('authError').style.display = 'none';
        location.reload();
    } catch (err) {
        console.error('Login error:', err);
    }
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
        if (!res.ok) {
            const err = await res.json();
            document.getElementById('authError').textContent = err.error || 'Registrierung fehlgeschlagen.';
            document.getElementById('authError').style.display = 'block';
            return;
        }
        const user = await res.json();
        currentUser = user;
        localStorage.setItem('sfz_user', JSON.stringify(user));
        document.getElementById('authModal').classList.remove('active');
        document.getElementById('authError').style.display = 'none';
        location.reload();
    } catch (err) {
        console.error('Register error:', err);
    }
}

async function doSearch() {
    const q = document.getElementById('searchInput').value;
    if (!currentUser) { document.getElementById('authModal').classList.add('active'); return; }
    if (!q) return;

    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();

        // Merge search results into allListings so showDetail can find them
        results.forEach(r => {
            if (!allListings.find(l => l.id === r.id)) {
                allListings.push(r);
            }
        });

        switchView('listings');
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="listings"]').classList.add('active');

        const container = document.getElementById('listingsGrid');
        if (results.length === 0) {
            container.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-light)">Keine Ergebnisse gefunden.</p>';
            return;
        }

        container.innerHTML = results.map(item => `
            <div class="card" onclick="showDetail(${item.id})">
                <div class="card-header">
                    <span class="card-type ${item.type}">${escapeHtml(item.type)}</span>
                    ${getCategoryBadge(item.category)}
                </div>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.description?.substring(0, 100))}...</p>
                ${renderImages(item)}
            <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
                <div class="card-footer">
                    <span>${escapeHtml(item.author_name)}</span>
                    <span>🔍 Suchtreffer</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Search error:', err);
    }
}

async function createListing(e) {
    e.preventDefault();
    if (!currentUser) {
        document.getElementById('authModal').classList.add('active');
        return;
    }

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

    try {
        const res = await fetch('/api/listings', { method: 'POST', body: data });
        if (!res.ok) {
            if (res.status === 401) {
                document.getElementById('authModal').classList.add('active');
                return;
            }
            const err = await res.json().catch(() => ({error: 'Unbekannter Fehler'}));
            alert(err.error || 'Fehler beim Erstellen');
            return;
        }
        document.getElementById('createForm').reset();
        switchView('listings');
        loadData();
    } catch (err) {
        console.error('Error creating listing:', err);
    }
}

function showDetail(id) {
    const item = allListings.find(l => l.id === id);
    if (!item) return;

    const priceDisplay = item.price ? `
        <div style="background:linear-gradient(135deg, var(--primary), var(--secondary));color:white;padding:16px;border-radius:8px;margin:20px 0">
            <strong>Preis:</strong> ${escapeHtml(item.price)}${item.vb == 1 ? ' (VB)' : ''}
        </div>
    ` : '';

    const content = document.getElementById('detailContent');
    content.innerHTML = `
        <span class="card-type ${item.type}" style="margin-bottom:16px;display:inline-block">${escapeHtml(item.type)}</span>
        <h2>${escapeHtml(item.title)}</h2>
        <div style="display:flex;align-items:center;gap:8px;margin:8px 0">${getCategoryBadge(item.category)} <span style="color:var(--text-light);font-size:0.9rem"> • Von ${escapeHtml(item.author_name)}</span></div>
        <hr style="margin:20px 0;border:none;border-top:1px solid var(--border)">
        <p style="line-height:1.8">${escapeHtml(item.description).replace(/\n/g, '<br>')}</p>
        ${renderImages(item, true)}
        ${priceDisplay}
        <div class="tags" style="margin:20px 0">
            ${item.tags?.split(',').map(t => `<span class="tag">${escapeHtml(t.trim())}</span>`).join('') || 'Keine Tags'}
        </div>
        <div style="background:var(--bg);padding:16px;border-radius:8px">
            <strong>Kontakt:</strong> ${escapeHtml(item.contact) || '<em style="color:var(--text-light)">(Nicht öffentlich)</em>'}
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
        <div style="text-align:center;margin-bottom:20px">
            <div class="person-avatar" style="width:80px;height:80px;font-size:2rem;margin:0 auto 16px">${displayName.charAt(0).toUpperCase()}</div>
            <h2>${displayName}</h2>
            <p style="color:var(--text-light)">${escapeHtml(user.grade) || 'SFZ Mitglied'}</p>
        </div>
        <div style="margin:20px 0">
            <strong>Interessen:</strong><br>
            <p style="margin:8px 0;color:var(--text)">${escapeHtml(user.interests) || 'Keine angegeben'}</p>
        </div>
        <div style="margin:20px 0">
            <strong>Skills:</strong><br>
            <p style="margin:8px 0;color:var(--text)">${escapeHtml(user.skills) || 'Keine angegeben'}</p>
        </div>
        <div style="background:linear-gradient(135deg, var(--primary), var(--secondary));color:white;padding:16px;border-radius:8px;margin-top:20px">
            <strong>Kontakt:</strong> ${escapeHtml(user.contact) || '<em style="opacity:0.8">(Nicht öffentlich)</em>'}
        </div>
    `;
    document.getElementById('detailModal').classList.add('active');
    if (window.lucide) lucide.createIcons();
}

async function loadAccount() {
    if (!currentUser) return;
    const container = document.getElementById('accountInfo');
    
    // Add visual indicator if contact is hidden
    const hiddenBadge = currentUser.hide_contact === 1 || currentUser.hide_contact === true
        ? ' <span style="font-size:0.8rem;color:var(--text-light);background:var(--bg);padding:2px 6px;border-radius:4px;display:inline-flex;align-items:center;gap:4px"><i data-lucide="lock" style="width:12px;height:12px"></i> Verborgen</span>' 
        : '';
        
    
    const displayName = escapeHtml(currentUser.full_name || currentUser.name);
    const initial = displayName.charAt(0).toUpperCase();
    
    container.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:24px; align-items:center; margin-bottom:24px; padding-bottom:24px; border-bottom:1px solid var(--border)">
            <div class="person-avatar" style="width:80px; height:80px; font-size:2rem; margin:0; flex-shrink:0;">
                ${initial}
            </div>
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
                <p style="margin:0; line-height:1.5; color:var(--text); font-size:0.95rem;">${escapeHtml(currentUser.interests) || '<em style="color:var(--text-light)">Keine angegeben</em>'}</p>
            </div>
            
            <div style="background:var(--bg); padding:16px; border-radius:12px; border:1px solid var(--border);">
                <div style="font-size:0.8rem; color:var(--text-light); font-weight:700; text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="zap" style="width:14px;height:14px; color:var(--accent)"></i> Skills
                </div>
                <p style="margin:0; line-height:1.5; color:var(--text); font-size:0.95rem;">${escapeHtml(currentUser.skills) || '<em style="color:var(--text-light)">Keine angegeben</em>'}</p>
            </div>

            <div style="background:var(--bg); padding:16px; border-radius:12px; border:1px solid var(--border);">
                <div style="font-size:0.8rem; color:var(--text-light); font-weight:700; text-transform:uppercase; margin-bottom:8px; display:flex; align-items:center; gap:6px;">
                    <i data-lucide="mail" style="width:14px;height:14px; color:var(--secondary)"></i> Kontakt
                </div>
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
                    <p style="margin:0; color:var(--text); font-size:0.95rem;">${escapeHtml(currentUser.contact) || '<em style="color:var(--text-light)">Keine angegeben</em>'}</p>
                    ${hiddenBadge}
                </div>
            </div>
        </div>
    `;

    try {
        const res = await fetch(`/api/users/${currentUser.id}/listings`);
        const items = await res.json();
        
        items.forEach(r => {
            if (!allListings.find(l => l.id === r.id)) allListings.push(r);
        });

        document.getElementById('myListings').innerHTML = items.map(item => `
            <div class="card">
                <div class="card-header">
                    <span class="card-type ${item.type}">${escapeHtml(item.type)}</span>
                    ${getCategoryBadge(item.category, "margin-left:auto")}
                    
                    <div class="card-actions">
                        <button class="action-btn" onclick="event.stopPropagation(); startEdit(${item.id})" title="Bearbeiten">
                            <i data-lucide="pencil" style="width:16px;height:16px"></i>
                        </button>
                        <button class="action-btn delete" onclick="event.stopPropagation(); deleteListing(${item.id})" title="Löschen">
                            <i data-lucide="trash-2" style="width:16px;height:16px"></i>
                        </button>
                    </div>
                </div>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.description?.substring(0, 100))}...</p>
                ${renderImages(item)}
                <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
            </div>
        `).join('') || '<p style="color:var(--text-light)">Noch keine Anzeigen.</p>';
    } catch (err) {
        console.error('Account load error:', err);
    }
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
    
    // Set checkbox state based on currentUser data (make sure it handles 1/0 or true/false)
    const isHidden = currentUser.hide_contact === 1 || currentUser.hide_contact === true;
    const checkbox = document.getElementById('profHideContact');
    if (checkbox) checkbox.checked = isHidden;
    
    document.getElementById('editProfileModal').classList.add('active');
}

async function saveProfile(e) {
    e.preventDefault();
    const checkbox = document.getElementById('profHideContact');
    const data = {
        name: document.getElementById('profName').value,
        full_name: document.getElementById('profFullName').value,
        grade: document.getElementById('profGrade').value,
        interests: document.getElementById('profInterests').value,
        skills: document.getElementById('profSkills').value,
        contact: document.getElementById('profContact').value,
        hide_contact: checkbox ? checkbox.checked : false
    };
    
    try {
        const res = await apiCall('/api/me', 'PUT', data);
        if (res.ok) {
            const freshUser = await res.json();
            currentUser = freshUser;
            localStorage.setItem('sfz_user', JSON.stringify(freshUser));
            document.getElementById('editProfileModal').classList.remove('active');
            loadAccount();
            
            // Reload discovery if interests changed
            loadData();
        } else {
            const errorData = await res.json();
            alert(errorData.error || 'Fehler beim Speichern');
        }
    } catch (err) { console.error(err); }
}

async function deleteListing(id) {
    if (!confirm('Anzeige wirklich löschen?')) return;
    try {
        const res = await apiCall(`/api/listings/${id}`, 'DELETE');
        if (res.ok) {
            loadAccount();
            loadData();
        } else {
            alert('Fehler beim Löschen');
        }
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
        if (res.ok) {
            document.getElementById('editModal').classList.remove('active');
            loadAccount();
            loadData();
        } else {
            alert('Fehler beim Speichern');
        }
    } catch (err) { console.error(err); }
}

// Bug Report
async function submitBug(e) {
    e.preventDefault();
    const data = {
        category: document.getElementById('bugCategory').value,
        title: document.getElementById('bugTitle').value,
        description: document.getElementById('bugDesc').value,
        reporter: document.getElementById('bugReporter').value || 'Anonymous'
    };

    try {
        const res = await fetch('/api/bugs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(data)
        });

        if (res.ok) {
            document.getElementById('bugForm').reset();
            document.getElementById('bugSuccess').style.display = 'block';
            setTimeout(() => {
                document.getElementById('bugModal').classList.remove('active');
                document.getElementById('bugSuccess').style.display = 'none';
            }, 2000);
        }
    } catch (err) {
        console.error('Error submitting bug:', err);
    }
}
