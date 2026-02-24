// SFZ Marktplatz - Frontend mit Master-Passwort
let sfzAuth = localStorage.getItem('sfz_auth') || null;
let currentUser = JSON.parse(localStorage.getItem('sfz_user') || 'null');
let allListings = [];
let allUsers = [];

// Init
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initAuth();
    loadData();
    setupEventListeners();
});

function initNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view === 'create' && !sfzAuth) {
                document.getElementById('loginModal').classList.add('active');
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
    
    if (view === 'listings') renderListings('all');
    if (view === 'people') renderPeople();
    if (view === 'discover') loadDiscovery();
}

function initAuth() {
    const userMenu = document.getElementById('userMenu');
    if (sfzAuth && currentUser) {
        userMenu.innerHTML = `
            <span>Hallo, <strong>${currentUser.name}</strong></span>
            <button onclick="logout()" style="margin-left:10px">Abmelden</button>
        `;
        document.getElementById('matchCard').style.display = 'block';
    } else {
        document.getElementById('loginBtn').addEventListener('click', () => {
            if (sfzAuth && !currentUser) {
                document.getElementById('userModal').classList.add('active');
            } else {
                document.getElementById('loginModal').classList.add('active');
            }
        });
    }
}

function logout() {
    sfzAuth = null;
    currentUser = null;
    localStorage.removeItem('sfz_auth');
    localStorage.removeItem('sfz_user');
    location.reload();
}

// API Helper mit Auth
async function apiPost(url, data) {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-SFZ-Auth': sfzAuth
        },
        body: JSON.stringify(data)
    });
}

// API Calls
async function loadData() {
    try {
        const [listingsRes, usersRes] = await Promise.all([
            fetch('/api/listings'),
            fetch('/api/users')
        ]);
        allListings = await listingsRes.json();
        allUsers = await usersRes.json();
        loadDiscovery();
    } catch (err) {
        console.error('Error loading data:', err);
    }
}

async function loadDiscovery() {
    await loadRandom();
    if (currentUser) await loadMatches();
    renderActiveUsers();
}

async function loadRandom() {
    try {
        const res = await fetch('/api/discover');
        const items = await res.json();
        const container = document.getElementById('randomListings');
        container.innerHTML = items.map(item => `
            <div class="mini-item" onclick="showDetail(${item.id})">
                <h4>${item.title}</h4>
                <div class="meta">${item.author_name} • ${item.category}</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading random:', err);
    }
}

async function loadMatches() {
    try {
        const res = await fetch(`/api/match/${currentUser.id}`);
        const items = await res.json();
        const container = document.getElementById('matchListings');
        if (items.length === 0) {
            container.innerHTML = '<p style="color: var(--text-light);">Noch keine passenden Anzeigen gefunden. Erstelle dein Profil mit Interessen!</p>';
            return;
        }
        container.innerHTML = items.map(item => `
            <div class="mini-item" onclick="showDetail(${item.id})">
                <h4>${item.title}</h4>
                <div class="meta">Match: ${item.score} gemeinsame Tags</div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error loading matches:', err);
    }
}

function renderActiveUsers() {
    const container = document.getElementById('activeUsers');
    container.innerHTML = allUsers.slice(0, 8).map(user => `
        <span class="user-chip" onclick="showUserProfile(${user.id})">${user.name}</span>
    `).join('');
}

function formatPrice(price, vb) {
    if (!price) return '';
    let p = price;
    if (vb == 1 || vb === true) p += ' VB';
    return `<span style="color:var(--primary);font-weight:600">${p}</span>`;
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
                <span class="card-type ${item.type}">${item.type}</span>
                <span style="font-size:0.8rem;color:var(--text-light)">${item.category}</span>
            </div>
            <h3>${item.title}</h3>
            <p>${item.description?.substring(0, 100)}...</p>
            <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
            <div class="tags">
                ${item.tags?.split(',').map(t => `<span class="tag">${t.trim()}</span>`).join('') || ''}
            </div>
            <div class="card-footer">
                <span>${item.author_name}</span>
                <span>${new Date(item.created_at).toLocaleDateString()}</span>
            </div>
        </div>
    `).join('');
}

function renderPeople() {
    const container = document.getElementById('peopleGrid');
    container.innerHTML = allUsers.map(user => `
        <div class="person-card" onclick="showUserProfile(${user.id})">
            <div class="person-avatar">${user.name.charAt(0).toUpperCase()}</div>
            <h3>${user.name}</h3>
            <div class="grade">${user.grade || 'SFZ'}</div>
            <div class="person-skills">
                ${user.interests?.substring(0, 30) || 'Keine Interessen angegeben'}...
            </div>
        </div>
    `).join('');
}

// Event Listeners
function setupEventListeners() {
    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderListings(btn.dataset.filter);
        });
    });

    // Search
    document.getElementById('searchBtn').addEventListener('click', doSearch);
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') doSearch();
    });

    // Forms
    document.getElementById('loginForm').addEventListener('submit', doLogin);
    document.getElementById('userForm').addEventListener('submit', createUser);
    document.getElementById('createForm').addEventListener('submit', createListing);
    document.getElementById('bugForm').addEventListener('submit', submitBug);

    // Close modals
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.remove('active');
        });
    });
}

async function doLogin(e) {
    e.preventDefault();
    const password = document.getElementById('masterPassword').value;
    
    try {
        const res = await fetch('/api/auth', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({password})
        });
        
        if (res.ok) {
            sfzAuth = password;
            localStorage.setItem('sfz_auth', password);
            document.getElementById('loginModal').classList.remove('active');
            document.getElementById('loginError').style.display = 'none';
            // Zeige Profil-Modal direkt danach
            document.getElementById('userModal').classList.add('active');
        } else {
            document.getElementById('loginError').style.display = 'block';
        }
    } catch (err) {
        console.error('Login error:', err);
    }
}

async function doSearch() {
    const q = document.getElementById('searchInput').value;
    if (!q) return;
    
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const results = await res.json();
        
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
                    <span class="card-type ${item.type}">${item.type}</span>
                    <span style="font-size:0.8rem;color:var(--text-light)">${item.category}</span>
                </div>
                <h3>${item.title}</h3>
                <p>${item.description?.substring(0, 100)}...</p>
                <div style="margin:8px 0">${formatPrice(item.price, item.vb)}</div>
                <div class="card-footer">
                    <span>${item.author_name}</span>
                    <span>🔍 Suchtreffer</span>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('Search error:', err);
    }
}

async function createUser(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('userName').value,
        grade: document.getElementById('userGrade').value,
        interests: document.getElementById('userInterests').value,
        skills: document.getElementById('userSkills').value,
        contact: document.getElementById('userContact').value
    };
    
    try {
        const res = await apiPost('/api/users', data);
        const result = await res.json();
        currentUser = {id: result.id, ...data};
        localStorage.setItem('sfz_user', JSON.stringify(currentUser));
        document.getElementById('userModal').classList.remove('active');
        location.reload();
    } catch (err) {
        console.error('Error creating user:', err);
    }
}

async function createListing(e) {
    e.preventDefault();
    if (!sfzAuth || !currentUser) {
        document.getElementById('loginModal').classList.add('active');
        return;
    }
    
    const data = {
        user_id: currentUser.id,
        title: document.getElementById('title').value,
        type: document.getElementById('type').value,
        category: document.getElementById('category').value,
        description: document.getElementById('description').value,
        tags: document.getElementById('tags').value,
        price: document.getElementById('price').value,
        vb: document.getElementById('vb').checked
    };
    
    try {
        await apiPost('/api/listings', data);
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
            <strong>Preis:</strong> ${item.price}${item.vb == 1 ? ' (VB)' : ''}
        </div>
    ` : '';
    
    const content = document.getElementById('detailContent');
    content.innerHTML = `
        <span class="card-type ${item.type}" style="margin-bottom:16px;display:inline-block">${item.type}</span>
        <h2>${item.title}</h2>
        <p style="color:var(--text-light);margin:8px 0">${item.category} • Von ${item.author_name}</p>
        <hr style="margin:20px 0;border:none;border-top:1px solid var(--border)">
        <p style="line-height:1.8">${item.description?.replace(/\n/g, '<br>')}</p>
        ${priceDisplay}
        <div class="tags" style="margin:20px 0">
            ${item.tags?.split(',').map(t => `<span class="tag">${t.trim()}</span>`).join('') || 'Keine Tags'}
        </div>
        <div style="background:var(--bg);padding:16px;border-radius:8px">
            <strong>Kontakt:</strong> ${item.contact || 'Über Profil'}
        </div>
    `;
    document.getElementById('detailModal').classList.add('active');
}

function showUserProfile(id) {
    const user = allUsers.find(u => u.id === id);
    if (!user) return;
    
    const content = document.getElementById('detailContent');
    content.innerHTML = `
        <div style="text-align:center;margin-bottom:20px">
            <div class="person-avatar" style="width:80px;height:80px;font-size:2rem;margin:0 auto 16px">${user.name.charAt(0).toUpperCase()}</div>
            <h2>${user.name}</h2>
            <p style="color:var(--text-light)">${user.grade || 'SFZ Mitglied'}</p>
        </div>
        <div style="margin:20px 0">
            <strong>Interessen:</strong><br>
            <p style="margin:8px 0;color:var(--text)">${user.interests || 'Keine angegeben'}</p>
        </div>
        <div style="margin:20px 0">
            <strong>Skills:</strong><br>
            <p style="margin:8px 0;color:var(--text)">${user.skills || 'Keine angegeben'}</p>
        </div>
        <div style="background:linear-gradient(135deg, var(--primary), var(--secondary));color:white;padding:16px;border-radius:8px;margin-top:20px">
            <strong>Kontakt:</strong> ${user.contact}
        </div>
    `;
    document.getElementById('detailModal').classList.add('active');
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
