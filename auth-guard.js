/**
 * EasyWin Auth Guard
 * Include this script at the TOP of every operational page (before any other logic).
 * It checks for a valid JWT token and redirects to login if missing/expired.
 * Also provides: easywinUser object, logout function, and injects user info into navbar.
 */

(function() {
    'use strict';

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3001/api' : '/api';

    const token = localStorage.getItem('easywin_token');
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';

    // No token → redirect to login immediately
    if (!token) {
        window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
        // Stop page rendering
        document.documentElement.style.display = 'none';
        return;
    }

    // Decode JWT to check expiry (without library)
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            localStorage.removeItem('easywin_token');
            localStorage.removeItem('easywin_user');
            window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
            document.documentElement.style.display = 'none';
            return;
        }
    } catch (e) {
        localStorage.removeItem('easywin_token');
        localStorage.removeItem('easywin_user');
        window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
        document.documentElement.style.display = 'none';
        return;
    }

    // Expose user info globally
    try {
        window.easywinUser = JSON.parse(localStorage.getItem('easywin_user') || '{}');
    } catch (e) {
        window.easywinUser = {};
    }
    window.easywinToken = token;

    // Global logout function
    window.easywinLogout = function() {
        localStorage.removeItem('easywin_token');
        localStorage.removeItem('easywin_user');
        window.location.href = 'login.html';
    };

    // When DOM is ready, update the navbar
    document.addEventListener('DOMContentLoaded', function() {
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        // Find and replace the "Area Clienti" button with user menu
        const areaClientiBtn = navLinks.querySelector('a[href*="login"], a[href*="#login"]');
        if (areaClientiBtn) {
            areaClientiBtn.remove();
        }

        // Create user menu
        const userMenu = document.createElement('div');
        userMenu.className = 'nav-user-menu';
        userMenu.innerHTML = `
            <div class="nav-user-trigger" onclick="this.parentElement.classList.toggle('open')">
                <div class="nav-user-avatar">
                    <i class="fas fa-user"></i>
                </div>
                <span class="nav-user-name">${window.easywinUser.nome || window.easywinUser.username || 'Utente'}</span>
                <i class="fas fa-chevron-down nav-user-arrow"></i>
            </div>
            <div class="nav-user-dropdown">
                <div class="nav-user-info">
                    <strong>${window.easywinUser.nome || ''} ${window.easywinUser.cognome || ''}</strong>
                    <span>${window.easywinUser.email || ''}</span>
                </div>
                <div class="nav-user-divider"></div>
                <a href="#" onclick="easywinLogout(); return false;" class="nav-user-logout">
                    <i class="fas fa-sign-out-alt"></i> Esci
                </a>
            </div>
        `;
        navLinks.appendChild(userMenu);

        // Close dropdown on outside click
        document.addEventListener('click', function(e) {
            if (!userMenu.contains(e.target)) {
                userMenu.classList.remove('open');
            }
        });
    });

    // Validate token with server (non-blocking, in background)
    fetch(`${API_BASE}/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => {
        if (!r.ok) {
            localStorage.removeItem('easywin_token');
            localStorage.removeItem('easywin_user');
            window.location.href = `login.html?redirect=${encodeURIComponent(currentPage)}`;
        }
    }).catch(() => {
        // Network error — don't kick user out, they might be offline
    });

})();
