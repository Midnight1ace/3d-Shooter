function sanitizeName(value, fallback = 'game') {
    const normalized = String(value || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || fallback;
}

function buildSessionId(name) {
    const d = new Date();
    const pad = (n, size = 2) => String(n).padStart(size, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
    const rand = Math.random().toString(36).slice(2, 8);
    return `${stamp}-${sanitizeName(name)}-${rand}`;
}

function serializeValue(value) {
    if (value == null) return value;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack || null
        };
    }
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return String(value);
    }
}

function serializeArgs(args) {
    return args.map(serializeValue);
}

export function createRuntimeLogger({
    endpoint = '/__logs',
    enabled = true,
    name = 'game',
    flushIntervalMs = 1000,
    maxQueue = 8000,
    mouseMoveSampleMs = 50
} = {}) {
    const loggerName = sanitizeName(name, 'game');
    const sessionId = buildSessionId(loggerName);
    const queue = [];
    const listeners = [];
    let flushTimer = null;
    let isFlushing = false;
    let started = false;
    let stopped = false;
    let inConsolePatch = false;
    let droppedCount = 0;
    let lastMouseMoveLogTs = 0;
    let consecutiveFlushFailures = 0;
    let nextFlushAllowedAt = 0;
    let nextWarnAllowedAt = 0;

    const originalConsoleError = console.error.bind(console);
    const originalConsoleWarn = console.warn.bind(console);

    function enqueue(level, event, data = {}) {
        if (!enabled || stopped) return;
        if (queue.length >= maxQueue) {
            queue.shift();
            droppedCount += 1;
        }
        queue.push({
            ts: new Date().toISOString(),
            level,
            event,
            data
        });
    }

    async function flush() {
        if (!enabled || stopped || isFlushing || queue.length === 0) return;
        const now = Date.now();
        if (now < nextFlushAllowedAt) return;
        isFlushing = true;
        const batch = queue.splice(0, queue.length);
        if (droppedCount > 0) {
            batch.unshift({
                ts: new Date().toISOString(),
                level: 'warn',
                event: 'logger.queue_dropped',
                data: { droppedCount }
            });
            droppedCount = 0;
        }
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    name: loggerName,
                    entries: batch
                }),
                keepalive: true
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            consecutiveFlushFailures = 0;
            nextFlushAllowedAt = 0;
        } catch (error) {
            // If send fails, requeue (bounded) so logs are not lost instantly.
            for (let i = 0; i < batch.length; i++) {
                enqueue(batch[i].level, batch[i].event, batch[i].data);
            }
            consecutiveFlushFailures += 1;
            const backoffMs = Math.min(30000, 500 * Math.pow(2, Math.min(consecutiveFlushFailures - 1, 6)));
            nextFlushAllowedAt = Date.now() + backoffMs;
            if (Date.now() >= nextWarnAllowedAt) {
                originalConsoleWarn(
                    `[RuntimeLogger] flush failed (${consecutiveFlushFailures}x). Retrying in ${Math.round(backoffMs / 1000)}s:`,
                    error?.message || error
                );
                nextWarnAllowedAt = Date.now() + 10000;
            }
        } finally {
            isFlushing = false;
        }
    }

    function addListener(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        listeners.push(() => target.removeEventListener(type, handler, options));
    }

    function patchConsole() {
        console.error = (...args) => {
            if (!inConsolePatch) {
                try {
                    inConsolePatch = true;
                    enqueue('error', 'console.error', { args: serializeArgs(args) });
                } finally {
                    inConsolePatch = false;
                }
            }
            originalConsoleError(...args);
        };

        console.warn = (...args) => {
            if (!inConsolePatch) {
                try {
                    inConsolePatch = true;
                    enqueue('warn', 'console.warn', { args: serializeArgs(args) });
                } finally {
                    inConsolePatch = false;
                }
            }
            originalConsoleWarn(...args);
        };

        listeners.push(() => {
            console.error = originalConsoleError;
            console.warn = originalConsoleWarn;
        });
    }

    function installWindowErrorHooks() {
        addListener(window, 'error', (event) => {
            // Resource load errors
            if (event.target && event.target !== window) {
                enqueue('error', 'window.resource_error', {
                    tagName: event.target.tagName || null,
                    src: event.target.src || event.target.href || null
                });
                return;
            }
            enqueue('error', 'window.error', {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: serializeValue(event.error)
            });
        }, true);

        addListener(window, 'unhandledrejection', (event) => {
            enqueue('error', 'window.unhandledrejection', {
                reason: serializeValue(event.reason)
            });
        });
    }

    function installInputHooks() {
        addListener(document, 'keydown', (event) => {
            enqueue('info', 'input.keydown', {
                code: event.code,
                key: event.key,
                repeat: event.repeat,
                altKey: event.altKey,
                ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey
            });
        }, true);

        addListener(document, 'keyup', (event) => {
            enqueue('info', 'input.keyup', {
                code: event.code,
                key: event.key
            });
        }, true);

        addListener(document, 'mousedown', (event) => {
            enqueue('info', 'input.mousedown', {
                button: event.button,
                x: event.clientX,
                y: event.clientY
            });
        }, true);

        addListener(document, 'mouseup', (event) => {
            enqueue('info', 'input.mouseup', {
                button: event.button,
                x: event.clientX,
                y: event.clientY
            });
        }, true);

        addListener(document, 'click', (event) => {
            enqueue('info', 'input.click', {
                button: event.button,
                x: event.clientX,
                y: event.clientY,
                targetId: event.target?.id || null
            });
        }, true);

        addListener(document, 'wheel', (event) => {
            enqueue('info', 'input.wheel', {
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                deltaMode: event.deltaMode
            });
        }, { passive: true, capture: true });

        addListener(document, 'mousemove', (event) => {
            const now = performance.now();
            if (now - lastMouseMoveLogTs < mouseMoveSampleMs) return;
            lastMouseMoveLogTs = now;
            enqueue('info', 'input.mousemove', {
                x: event.clientX,
                y: event.clientY,
                movementX: event.movementX,
                movementY: event.movementY
            });
        }, true);

        addListener(document, 'pointerlockchange', () => {
            enqueue('info', 'input.pointerlockchange', {
                locked: Boolean(document.pointerLockElement),
                pointerLockElementId: document.pointerLockElement?.id || null
            });
        }, true);
    }

    function start() {
        if (started || stopped || !enabled) return;
        started = true;
        patchConsole();
        installWindowErrorHooks();
        installInputHooks();
        flushTimer = setInterval(() => {
            flush();
        }, flushIntervalMs);
        enqueue('info', 'logger.started', {
            sessionId,
            name: loggerName,
            href: window.location.href,
            userAgent: navigator.userAgent
        });
    }

    async function stop() {
        if (!started || stopped) return;
        stopped = true;
        if (flushTimer) {
            clearInterval(flushTimer);
            flushTimer = null;
        }
        enqueue('info', 'logger.stopped', { sessionId });
        try {
            await flush();
        } catch (_) {
            // ignore flush errors during shutdown
        }
        while (listeners.length) {
            const detach = listeners.pop();
            try {
                detach();
            } catch (_) {
                // ignore detach errors
            }
        }
    }

    return {
        start,
        stop,
        flush,
        log: (event, data) => enqueue('info', event, data),
        warn: (event, data) => enqueue('warn', event, data),
        error: (event, data) => enqueue('error', event, data),
        getSessionId: () => sessionId
    };
}
