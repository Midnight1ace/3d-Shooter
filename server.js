const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = 3000;
const ACTIVE_SESSIONS = new Map();
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
    if (req.method === 'POST' && req.url === '/api/register') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                if (!username || !password) return sendJson(res, 400, { ok: false, error: 'Missing fields' });
                
                const usersPath = path.join(process.cwd(), 'data', 'users.json');
                let users = [];
                try {
                    const data = await fsp.readFile(usersPath, 'utf8');
                    users = JSON.parse(data);
                } catch (e) { /* ignore if file doesn't exist */ }

                if (users.find(u => u.username === username)) {
                    return sendJson(res, 400, { ok: false, error: 'User already exists' });
                }

                const salt = crypto.randomBytes(16).toString('hex');
                const hash = crypto.scryptSync(password, salt, 64).toString('hex');

                users.push({ username, salt, hash });
                await fsp.writeFile(usersPath, JSON.stringify(users, null, 2));
                sendJson(res, 200, { ok: true, message: 'Registered successfully' });
            } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
        });
        return;
    }

    if (req.method === 'POST' && req.url === '/api/login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const { username, password } = JSON.parse(body);
                const usersPath = path.join(process.cwd(), 'data', 'users.json');
                const data = await fsp.readFile(usersPath, 'utf8');
                const users = JSON.parse(data);
                const user = users.find(u => u.username === username);
                
                if (user) {
                    const hash = crypto.scryptSync(password, user.salt, 64).toString('hex');
                    if (hash === user.hash) {
                        const token = crypto.randomBytes(32).toString('hex');
                        ACTIVE_SESSIONS.set(token, { username: user.username, createdAt: Date.now() });
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
        const lbPath = path.join(process.cwd(), 'data', 'leaderboard.json');
        if (req.method === 'GET') {
            try {
                const data = await fsp.readFile(lbPath, 'utf8');
                const scores = JSON.parse(data);
                sendJson(res, 200, { ok: true, scores });
            } catch (e) { sendJson(res, 200, { ok: true, scores: [] }); }
            return;
        }
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                const authHeader = req.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    return sendJson(res, 401, { ok: false, error: 'Unauthorized: Missing token' });
                }
                const token = authHeader.split(' ')[1];
                if (!ACTIVE_SESSIONS.has(token)) {
                    return sendJson(res, 401, { ok: false, error: 'Unauthorized: Invalid token' });
                }
                const session = ACTIVE_SESSIONS.get(token);

                try {
                    const { username, score, wave } = JSON.parse(body);
                    if (username !== session.username) {
                        return sendJson(res, 403, { ok: false, error: 'Forbidden: Username mismatch' });
                    }

                    let scores = [];
                    try {
                        const data = await fsp.readFile(lbPath, 'utf8');
                        scores = JSON.parse(data);
                    } catch (e) {}
                    scores.push({ username, score, wave, date: new Date().toISOString() });
                    scores.sort((a, b) => b.score - a.score);
                    scores = scores.slice(0, 50);
                    await fsp.writeFile(lbPath, JSON.stringify(scores, null, 2));
                    sendJson(res, 200, { ok: true });
                } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
            });
            return;
        }
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
