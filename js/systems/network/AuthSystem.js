/**
 * AuthSystem
 * Handles user registration, login, and leaderboard interactions.
 */
export const AuthSystem = {
    user: null,

    async register(username, password) {
        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Registration failed:', error);
            return { ok: false, error: 'Network error' };
        }
    },

    async login(username, password) {
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (data.ok) {
                this.user = { username: data.username, token: data.token };
                localStorage.setItem('shooter_user', JSON.stringify(this.user));
            }
            return data;
        } catch (error) {
            console.error('Login failed:', error);
            return { ok: false, error: 'Network error' };
        }
    },

    logout() {
        this.user = null;
        localStorage.removeItem('shooter_user');
    },

    checkSession() {
        const saved = localStorage.getItem('shooter_user');
        if (saved) {
            try {
                this.user = JSON.parse(saved);
                return this.user;
            } catch (e) {
                this.logout();
            }
        }
        return null;
    },

    async getLeaderboard() {
        try {
            const response = await fetch('/api/leaderboard');
            const data = await response.json();
            return data.scores || [];
        } catch (error) {
            console.error('Failed to fetch leaderboard:', error);
            return [];
        }
    },

    async startMatch() {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.user && this.user.token) {
                headers['Authorization'] = `Bearer ${this.user.token}`;
            } else {
                return { ok: false, error: 'Not logged in' };
            }
            const response = await fetch('/api/match/start', {
                method: 'POST',
                headers
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to start match:', error);
            return { ok: false, error: 'Network error' };
        }
    },

    async recordKill(matchId, role) {
        if (!matchId) return { ok: false };
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.user && this.user.token) {
                headers['Authorization'] = `Bearer ${this.user.token}`;
            }
            const response = await fetch('/api/match/kill', {
                method: 'POST',
                headers,
                body: JSON.stringify({ matchId, role })
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to record kill:', error);
            return { ok: false, error: 'Network error' };
        }
    },

    async endMatch(matchId, wave) {
        if (!matchId) return { ok: false };
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (this.user && this.user.token) {
                headers['Authorization'] = `Bearer ${this.user.token}`;
            }
            const response = await fetch('/api/match/end', {
                method: 'POST',
                headers,
                body: JSON.stringify({ matchId, wave })
            });
            return await response.json();
        } catch (error) {
            console.error('Failed to end match:', error);
            return { ok: false, error: 'Network error' };
        }
    }
};
