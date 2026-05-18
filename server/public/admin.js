const API_BASE = '/api';
let token = localStorage.getItem('admin_token');

const $authContainer = document.getElementById('auth-container');
const $adminContainer = document.getElementById('admin-container');
const $authForm = document.getElementById('auth-form');
const $usersBody = document.getElementById('users-body');
const $logoutBtn = document.getElementById('logout-btn');
const $inviteBtn = document.getElementById('invite-btn');
const $inviteModal = document.getElementById('invite-modal');
const $inviteForm = document.getElementById('invite-form');
const $cancelInvite = document.getElementById('cancel-invite');
const $bootstrapHint = document.getElementById('bootstrap-hint');

async function init() {
    feather.replace();
    if (token) {
        showDashboard();
    } else {
        checkBootstrap();
    }
}

async function checkBootstrap() {
    console.log('Checking system bootstrap status...');
    try {
        const res = await fetch(`${API_BASE}/auth/status`);
        if (!res.ok) throw new Error(`Status check failed with ${res.status}`);
        
        const data = await res.json();
        console.log('Bootstrap status:', data);
        
        if (!data.bootstrapped) {
            console.log('System is not bootstrapped. Switching to setup mode.');
            document.getElementById('auth-title').textContent = 'Initial Setup';
            document.getElementById('auth-subtitle').textContent = 'Create the first administrator account.';
            document.getElementById('auth-btn').textContent = 'Register Admin';
            $bootstrapHint.classList.remove('hidden');
        }
    } catch (e) {
        console.error('Failed to check bootstrap status:', e);
        // If we can't check status, we'll assume normal login mode but log the error
    }
}

$authForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        // Try bootstrap first if we suspect no users
        let res = await fetch(`${API_BASE}/auth/bootstrap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (res.status === 400) {
            // System already initialized, try normal login
            res = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
        }

        const data = await res.json();
        if (data.token) {
            if (data.user.role !== 'admin') {
                alert('Access denied. Admin only.');
                return;
            }
            token = data.token;
            localStorage.setItem('admin_token', token);
            showDashboard();
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (err) {
        alert('Connection error');
    }
};

async function showDashboard() {
    $authContainer.classList.add('hidden');
    $adminContainer.classList.remove('hidden');
    document.getElementById('user-email').textContent = 'Admin';
    loadUsers();
}

async function loadUsers() {
    const res = await fetch(`${API_BASE}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) return logout();
    const users = await res.json();
    
    $usersBody.innerHTML = users.map(user => `
        <tr>
            <td>${user.email}</td>
            <td><span class="badge badge-${user.role}">${user.role}</span></td>
            <td><span class="badge badge-${user.status}">${user.status}</span></td>
            <td>${new Date(user.createdAt).toLocaleDateString()}</td>
            <td class="actions-cell">
                ${user.status === 'pending' ? `<button class="btn-ghost" onclick="approveUser('${user._id}')">Approve</button>` : ''}
                <button class="btn-ghost btn-danger" onclick="deleteUser('${user._id}')">Delete</button>
            </td>
        </tr>
    `).join('');
    feather.replace();
}

window.approveUser = async (id) => {
    await fetch(`${API_BASE}/admin/approve/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    loadUsers();
};

window.deleteUser = async (id) => {
    if (!confirm('Are you sure you want to delete this user? All their synced data will be lost.')) return;
    await fetch(`${API_BASE}/admin/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    loadUsers();
};

$inviteBtn.onclick = () => $inviteModal.classList.remove('hidden');
$cancelInvite.onclick = () => $inviteModal.classList.add('hidden');

$inviteForm.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('invite-email').value;
    const tempPassword = document.getElementById('invite-password').value;

    const res = await fetch(`${API_BASE}/admin/invite`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email, tempPassword })
    });

    if (res.ok) {
        $inviteModal.classList.add('hidden');
        $inviteForm.reset();
        loadUsers();
    } else {
        const data = await res.json();
        alert(data.error);
    }
};

function logout() {
    localStorage.removeItem('admin_token');
    location.reload();
}

$logoutBtn.onclick = logout;

init();
