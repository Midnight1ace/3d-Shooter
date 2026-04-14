#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const config = {
    url: 'http://localhost:3000/',
    timeoutMs: 12000,
    headless: true,
    failOnWarning: false,
    outFile: null,
    outDir: 'reports',
    name: 'console-scan',
    clickStart: false,
    strict: false,
    keepOpen: true
};

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' && args[i + 1]) {
        config.url = args[++i];
    } else if (arg === '--timeout' && args[i + 1]) {
        const value = Number.parseInt(args[++i], 10);
        if (!Number.isNaN(value) && value > 0) {
            config.timeoutMs = value;
        }
    } else if (arg === '--headful') {
        config.headless = false;
    } else if (arg === '--fail-on-warning') {
        config.failOnWarning = true;
    } else if (arg === '--out' && args[i + 1]) {
        config.outFile = args[++i];
    } else if (arg === '--out-dir' && args[i + 1]) {
        config.outDir = args[++i];
    } else if (arg === '--name' && args[i + 1]) {
        config.name = args[++i];
    } else if (arg === '--click-start') {
        config.clickStart = true;
    } else if (arg === '--strict') {
        config.strict = true;
    } else if (arg === '--keep-open') {
        config.keepOpen = true;
    } else if (arg === '--no-keep-open') {
        config.keepOpen = false;
    }
}

function sanitizeToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'scan';
}

function timestampTag() {
    const d = new Date();
    const pad = (n, size = 2) => String(n).padStart(size, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

function resolveOutputFile(reason = '') {
    if (config.outFile) return config.outFile;
    let hostTag = 'unknown-host';
    try {
        const u = new URL(config.url);
        hostTag = sanitizeToken(u.host);
    } catch (_) {
        hostTag = sanitizeToken(config.url);
    }
    const baseName = sanitizeToken(config.name);
    const reasonTag = reason ? `-${sanitizeToken(reason)}` : '';
    const fileName = `${baseName}-${hostTag}${reasonTag}-${timestampTag()}.json`;
    return path.join(config.outDir, fileName);
}

async function loadPlaywright() {
    try {
        const mod = await import('playwright');
        return mod;
    } catch (error) {
        console.error('[scan-browser-console] Missing dependency: playwright');
        console.error('Install with: npm i -D playwright');
        process.exit(2);
    }
}

function nowIso() {
    return new Date().toISOString();
}

async function main() {
    const playwright = await loadPlaywright();
    const browser = await playwright.chromium.launch({ headless: config.headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    const report = {
        url: config.url,
        startedAt: nowIso(),
        consoleErrors: [],
        consoleWarnings: [],
        pageErrors: [],
        failedRequests: [],
        httpErrors: [],
        actionErrors: [],
        postStartSnapshot: null
    };
    let loadCount = 0;

    async function saveReport(reason = 'snapshot') {
        const resolvedOutFile = resolveOutputFile(reason);
        const outDir = path.dirname(resolvedOutFile);
        await mkdir(outDir, { recursive: true });
        await writeFile(resolvedOutFile, JSON.stringify(report, null, 2), 'utf8');
        return resolvedOutFile;
    }

    page.on('console', (msg) => {
        const payload = {
            type: msg.type(),
            text: msg.text(),
            location: msg.location()
        };
        if (msg.type() === 'error') {
            report.consoleErrors.push(payload);
        } else if (msg.type() === 'warning') {
            report.consoleWarnings.push(payload);
        }
    });

    page.on('pageerror', (error) => {
        report.pageErrors.push({
            name: error?.name || 'Error',
            message: error?.message || String(error),
            stack: error?.stack || null
        });
    });

    page.on('requestfailed', (request) => {
        report.failedRequests.push({
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            failure: request.failure()?.errorText || 'unknown'
        });
    });

    page.on('response', (response) => {
        const status = response.status();
        if (status >= 400) {
            report.httpErrors.push({
                status,
                url: response.url()
            });
        }
    });

    page.on('load', async () => {
        loadCount += 1;
        report.lastLoadAt = nowIso();
        try {
            const file = await saveReport(`load-${loadCount}`);
            console.log(`Auto-saved report on page load #${loadCount}: ${file}`);
        } catch (error) {
            console.error('[scan-browser-console] Failed to save load snapshot:', error?.message || error);
        }
    });

    try {
        await page.goto(config.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    } catch (error) {
        report.pageErrors.push({
            name: error?.name || 'NavigationError',
            message: error?.message || String(error),
            stack: error?.stack || null
        });
    }

    if (config.clickStart) {
        try {
            await page.waitForSelector('#start-button', { timeout: Math.min(5000, config.timeoutMs) });
            await page.click('#start-button');
            const settleMs = Math.max(2000, Math.floor(config.timeoutMs * 0.35));
            await page.waitForTimeout(settleMs);
            report.postStartSnapshot = await page.evaluate(() => {
                const getText = (id) => document.getElementById(id)?.textContent?.trim() || null;
                const hasHidden = (id) => document.getElementById(id)?.classList.contains('hidden') ?? null;
                return {
                    hudHidden: hasHidden('hud'),
                    startHidden: hasHidden('start-screen'),
                    upgradeHidden: hasHidden('upgrade-screen'),
                    pauseHidden: hasHidden('pause-screen'),
                    gameOverHidden: hasHidden('game-over-screen'),
                    enemiesText: getText('enemy-count'),
                    waveText: getText('wave'),
                    scoreText: getText('score'),
                    promptText: getText('interaction-prompt'),
                    pointerLock: !!document.pointerLockElement
                };
            });
        } catch (error) {
            report.actionErrors.push({
                action: 'click-start',
                message: error?.message || String(error)
            });
        }
    }

    await page.waitForTimeout(config.timeoutMs);
    report.finishedAt = nowIso();

    const resolvedOutFile = await saveReport('final');

    const errorCount =
        report.consoleErrors.length +
        report.pageErrors.length +
        report.failedRequests.length +
        report.httpErrors.length;
    const warningCount = report.consoleWarnings.length;

    console.log(`Scan URL: ${report.url}`);
    console.log(`Window: ${config.timeoutMs}ms`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Warnings: ${warningCount}`);
    console.log(`Report saved: ${resolvedOutFile}`);
    console.log('--- Report JSON ---');
    console.log(JSON.stringify(report, null, 2));

    if (config.keepOpen) {
        console.log('Scanner is still running. Keep interacting with the page. Press Ctrl+C to stop.');
        let stopping = false;
        const shutdown = async () => {
            if (stopping) return;
            stopping = true;
            try {
                report.stoppedAt = nowIso();
                await saveReport('stopped');
                await browser.close();
            } catch (error) {
                console.error('[scan-browser-console] Shutdown error:', error?.message || error);
            } finally {
                process.exit(0);
            }
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        await new Promise(() => {});
    } else {
        await browser.close();
        if (config.strict && errorCount > 0) {
            process.exit(1);
        }
        if (config.strict && config.failOnWarning && warningCount > 0) {
            process.exit(1);
        }
        process.exit(0);
    }
}

main().catch((error) => {
    console.error('[scan-browser-console] Fatal:', error);
    process.exit(2);
});
