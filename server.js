const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = 3000;
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
const db = new Database(path.join(dbDir, 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        salt TEXT,
        hash TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT,
        expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS leaderboard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT,
        score INTEGER,
        wave INTEGER,
        date TEXT
    );
    CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        username TEXT,
        score INTEGER,
        status TEXT,
        created_at INTEGER
    );
`);

setInterval(() => {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}, 60 * 60 * 1000);
const LOG_DIR = path.join(process.cwd(), 'reports', 'runtime-logs');
const MAX_LOG_PAYLOAD_BYTES = 2 * 1024 * 1024;

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
    '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream'
};

function sanitizeToken(value, fallback = 'unknown') {
    const token = String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return token || fallback;
}

function buildRuntimeLogFile(name, sessionId) {
    const safeName = sanitizeToken(name, 'gameplay');
    const safeSession = sanitizeToken(sessionId, 'session');
    return path.join(LOG_DIR, `${safeName}-${safeSession}.ndjson`);
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
    });
    res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
    // API Endpoints
    // Validate session utility
    const getSession = (req) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
        const token = authHeader.split(' ')[1];
        const row = db.prepare("SELECT username FROM sessions WHERE token = ? AND expires_at > ?").get(token, Date.now());
        return row ? { username: row.username, token } : null;
    };

    if (req.method === 'POST' && req.url === '/api/register') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                if (!username || !password) return sendJson(res, 400, { ok: false, error: 'Missing fields' });
                
                const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
                if (existing) {
                    return sendJson(res, 400, { ok: false, error: 'User already exists' });
                }

                const salt = crypto.randomBytes(16).toString('hex');
                const hash = crypto.scryptSync(password, salt, 64).toString('hex');

                db.prepare("INSERT INTO users (username, salt, hash) VALUES (?, ?, ?)").run(username, salt, hash);
                sendJson(res, 200, { ok: true, message: 'Registered successfully' });
            } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const user = db.prepare("SELECT username, salt, hash FROM users WHERE username = ?").get(username);
                
                if (user) {
                    const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
                    if (hash === user.hash) {
                        const token = crypto.randomBytes(32).toString('hex');
                        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
                        db.prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)").run(token, user.username, expiresAt);
                        sendJson(res, 200, { ok: true, username: user.username, token });
                    } else {
                        sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
                    }
                } else {
                    sendJson(res, 401, { ok: false, error: 'Invalid credentials' });
                }
            } catch (e) { sendJson(res, 500, { ok: false, error: 'Internal error' }); }
        });
        return;
    }

    if (req.url === '/api/leaderboard') {
        if (req.method === 'GET') {
            try {
                const scores = db.prepare("SELECT username, score, wave, date FROM leaderboard ORDER BY score DESC LIMIT 50").all();
                sendJson(res, 200, { ok: true, scores });
            } catch (e) { sendJson(res, 200, { ok: true, scores: [] }); }
            return;
        }
        if (req.method === 'POST') {
            return sendJson(res, 403, { ok: false, error: 'Direct submission disabled. Use match endpoints.' });
        }
    }
    
    // Server-Authoritative Match Endpoints
    if (req.method === 'POST' && req.url === '/api/match/start') {
        const session = getSession(req);
        if (!session) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        
        try {
            const matchId = crypto.randomBytes(16).toString('hex');
            db.prepare("INSERT INTO matches (match_id, username, score, status, created_at) VALUES (?, ?, 0, 'active', ?)").run(matchId, session.username, Date.now());
            return sendJson(res, 200, { ok: true, matchId });
        } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }); }
    }

    if (req.method === 'POST' && req.url === '/api/match/kill') {
        const session = getSession(req);
        if (!session) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { matchId, role } = JSON.parse(body);
                // Standard role scores
                const rolePoints = { 'normal': 100, 'flanker': 120, 'exploder': 90 };
                const points = rolePoints[role] || 100;
                
                const match = db.prepare("SELECT status FROM matches WHERE match_id = ? AND username = ?").get(matchId, session.username);
                if (!match || match.status !== 'active') return sendJson(res, 400, { ok: false, error: 'Invalid match' });
                
                db.prepare("UPDATE matches SET score = score + ? WHERE match_id = ?").run(points, matchId);
                sendJson(res, 200, { ok: true });
            } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/match/end') {
        const session = getSession(req);
        if (!session) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { matchId, wave } = JSON.parse(body);
                const match = db.prepare("SELECT score, status FROM matches WHERE match_id = ? AND username = ?").get(matchId, session.username);
                
                if (!match || match.status !== 'active') return sendJson(res, 400, { ok: false, error: 'Invalid matching' });
                
                db.prepare("UPDATE matches SET status = 'ended' WHERE match_id = ?").run(matchId);
                db.prepare("INSERT INTO leaderboard (username, score, wave, date) VALUES (?, ?, ?, ?)").run(session.username, match.score, wave, new Date().toISOString());
                
                sendJson(res, 200, { ok: true, score: match.score });
            } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
        });
        return;
    }

    if (req.method === 'POST' && req.url && req.url.startsWith('/__logs')) {
        let body = '';
        let tooLarge = false;

        req.on('data', (chunk) => {
            if (tooLarge) return;
            body += chunk;
            if (Buffer.byteLength(body, 'utf8') > MAX_LOG_PAYLOAD_BYTES) {
                tooLarge = true;
                sendJson(res, 413, { ok: false, error: 'Payload too large' });
                req.destroy();
            }
        });

        req.on('end', async () => {
            if (tooLarge) return;
            try {
                const parsed = body ? JSON.parse(body) : {};
                const name = parsed?.name || 'gameplay';
                const sessionId = parsed?.sessionId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
                if (!entries.length) return sendJson(res, 200, { ok: true, written: 0 });

                const logFile = buildRuntimeLogFile(name, sessionId);
                await fsp.mkdir(path.dirname(logFile), { recursive: true });

                const receivedAt = new Date().toISOString();
                const lines = entries.map((entry) => JSON.stringify({
                    sessionId, name, receivedAt, ...entry
                }));
                await fsp.appendFile(logFile, `${lines.join('\n')}\n`, 'utf8');

                sendJson(res, 200, { ok: true, written: entries.length, file: path.relative(process.cwd(), logFile) });
            } catch (error) {
                sendJson(res, 400, { ok: false, error: error?.message || 'Invalid log payload' });
            }
        });
        return;
    }

    // Static File Serving
    const requestPath = (() => {
        try {
            const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            return decodeURIComponent(parsed.pathname);
        } catch (error) {
            return '/';
        }
    })();

    let filePath = '.' + requestPath;
    if (filePath === './') filePath = './index.html';
    
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                fs.readFile('./404.html', (error, content) => {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end(content || '404 - Not Found', 'utf-8');
                });
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                Pragma: 'no-cache',
                Expires: '0'
            });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
