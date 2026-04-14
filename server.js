const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = 3000;
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

const server = http.createServer((req, res) => {
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
                if (!entries.length) {
                    sendJson(res, 200, { ok: true, written: 0 });
                    return;
                }

                const logFile = buildRuntimeLogFile(name, sessionId);
                await fsp.mkdir(path.dirname(logFile), { recursive: true });

                const receivedAt = new Date().toISOString();
                const lines = entries.map((entry) => JSON.stringify({
                    sessionId,
                    name,
                    receivedAt,
                    ...entry
                }));
                await fsp.appendFile(logFile, `${lines.join('\n')}\n`, 'utf8');

                sendJson(res, 200, { ok: true, written: entries.length, file: path.relative(process.cwd(), logFile) });
            } catch (error) {
                sendJson(res, 400, { ok: false, error: error?.message || 'Invalid log payload' });
            }
        });
        return;
    }

    console.log(`Request: ${req.url}`);
    
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }
    
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code === 'ENOENT') {
                fs.readFile('./404.html', (error, content) => {
                    res.writeHead(404, {
                        'Content-Type': 'text/html',
                        'Cache-Control': 'no-store, no-cache, must-revalidate',
                        Pragma: 'no-cache',
                        Expires: '0'
                    });
                    res.end(content, 'utf-8');
                });
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
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
    console.log('Press Ctrl+C to stop the server');
});
