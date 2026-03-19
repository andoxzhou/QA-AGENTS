// Web Recording mode: listens to user clicks/inputs on app.onekeytest.com via Chrome CDP
// Connects to Chrome browser on port 9223 (separate from OneKey desktop on 9222)
// Supports recording inside cross-origin iframes (e.g. tradingview.onekeytest.com)
// Saves steps.json incrementally (no data loss on force-quit)
// Includes live monitor web UI on port 3211 via SSE
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { createServer } from 'http';
import { spawn, execSync } from 'child_process';

const WEB_CDP_URL = process.env.WEB_CDP_URL || 'http://127.0.0.1:9223';
const WEB_URL = process.env.WEB_URL || 'https://app.onekeytest.com';
const RECORDING_DIR = resolve(import.meta.dirname, '../../shared/results/recording');
mkdirSync(RECORDING_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Chrome CDP Auto-Launch ──────────────────────────────────

async function ensureChromeRunning() {
  for (let i = 0; i < 2; i++) {
    try {
      const resp = await fetch(`${WEB_CDP_URL}/json/version`);
      if (resp.ok) { console.log('  Chrome CDP ready.'); return; }
    } catch {}
    if (i === 0) await sleep(500);
  }

  console.log('  Chrome CDP not responding, launching Chrome...');
  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const chromeBin = chromePaths.find(p => existsSync(p));
  if (!chromeBin) {
    throw new Error(
      `Chrome not found. Please start Chrome manually:\n` +
      `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ` +
      `--remote-debugging-port=9223 --user-data-dir=/tmp/chrome-cdp-profile ${WEB_URL}`
    );
  }

  const port = new URL(WEB_CDP_URL).port || '9223';
  const tmpProfile = '/tmp/chrome-cdp-profile';

  // Copy user's Chrome profile for login state & cookies
  if (!existsSync(`${tmpProfile}/Default/Preferences`)) {
    const chromeDir = `${process.env.HOME}/Library/Application Support/Google/Chrome`;
    let profileDir = null;
    if (existsSync(chromeDir)) {
      const entries = readdirSync(chromeDir);
      const profiles = entries.filter(e => e.startsWith('Profile ')).sort();
      profileDir = profiles.length > 0
        ? `${chromeDir}/${profiles[profiles.length - 1]}`
        : existsSync(`${chromeDir}/Default`) ? `${chromeDir}/Default` : null;
    }
    if (profileDir && existsSync(profileDir)) {
      execSync(`mkdir -p "${tmpProfile}" && cp -r "${profileDir}" "${tmpProfile}/Default"`, { stdio: 'ignore' });
      console.log(`  Copied Chrome profile (${profileDir.split('/').pop()}) to temp dir`);
    }
  }

  const child = spawn(chromeBin, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmpProfile}`,
    '--no-first-run',
    WEB_URL,
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const resp = await fetch(`${WEB_CDP_URL}/json/version`);
      if (resp.ok) { console.log(`  Chrome ready after ${i + 1}s`); return; }
    } catch {}
  }
  throw new Error('Chrome failed to start within 30s');
}

// ── Connect & Find Target Page ──────────────────────────────

async function connectWebCDP() {
  await ensureChromeRunning();
  const browser = await chromium.connectOverCDP(WEB_CDP_URL);
  const contexts = browser.contexts();
  let page = null;

  // Find existing tab with onekeytest.com
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      if (p.url().includes('onekeytest.com')) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  // If no onekeytest tab, use first real page and navigate
  if (!page) {
    const allPages = contexts.flatMap(c => c.pages());
    page = allPages.find(p => !p.url().startsWith('chrome://'));
    if (!page) {
      const ctx = contexts[0] || await browser.newContext();
      page = await ctx.newPage();
    }
    console.log(`  No onekeytest.com tab found, navigating to ${WEB_URL}...`);
    await page.goto(WEB_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
  }

  console.log(`  Connected to page: ${page.url()}`);
  return { browser, page };
}

// ── Main ─────────────────────────────────────────────────────

const { browser, page } = await connectWebCDP();

let stepNum = 0;
const allSteps = [];
const sseClients = [];

function broadcast(step) {
  const data = `data: ${JSON.stringify(step)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

function saveSteps() {
  writeFileSync(`${RECORDING_DIR}/steps.json`, JSON.stringify(allSteps, null, 2));
}

const MONITOR_PORT = 3211;

const MONITOR_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web Recording Monitor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; }
  header { position: sticky; top: 0; z-index: 10; background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #3fb950; animation: pulse 1.5s infinite; }
  .dot.stopped { background: #f85149; animation: none; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .stats { display: flex; gap: 24px; font-size: 14px; color: #8b949e; }
  .stats span { color: #c9d1d9; font-weight: 600; }
  .tag-web { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #1f6feb33; color: #58a6ff; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 60px; }
  thead { position: sticky; top: 49px; background: #161b22; z-index: 5; }
  th { text-align: left; padding: 10px 12px; font-size: 12px; text-transform: uppercase; color: #8b949e; border-bottom: 1px solid #30363d; }
  td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr.new-row { animation: highlight 1.5s ease-out; }
  @keyframes highlight { from { background: rgba(56, 139, 253, 0.15); } to { background: transparent; } }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-click { background: #1f6feb33; color: #58a6ff; }
  .badge-input { background: #3fb95033; color: #3fb950; }
  .badge-nav { background: #d2a8ff33; color: #d2a8ff; }
  .testid { color: #d2a8ff; font-family: monospace; font-size: 12px; }
  .no-testid { color: #484f58; font-style: italic; }
  .frame-tag { color: #f0883e; font-family: monospace; font-size: 11px; }
  .content { max-width: 400px; word-break: break-all; }
  .pos { color: #8b949e; font-family: monospace; font-size: 12px; }
  .time { color: #8b949e; font-size: 12px; }
  .del-btn { background: none; border: 1px solid #f8514933; color: #f85149; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 11px; }
  .del-btn:hover { background: #f8514922; }
  tr.deleting { opacity: 0.3; text-decoration: line-through; transition: opacity 0.3s; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; background: #161b22; border-top: 1px solid #30363d; padding: 10px 24px; font-size: 12px; color: #8b949e; text-align: center; }
  #empty { text-align: center; padding: 60px 20px; color: #484f58; }
  #empty .icon { font-size: 48px; margin-bottom: 16px; }
  #empty p { font-size: 16px; }
</style>
</head>
<body>
<header>
  <div class="dot" id="statusDot"></div>
  <div style="font-size:16px;font-weight:600;">Web Recording Monitor</div>
  <span class="tag-web">WEB CDP:9223</span>
  <div class="stats">
    Steps: <span id="stepCount">0</span>
    &nbsp;&nbsp;
    Elapsed: <span id="elapsed">00:00</span>
  </div>
</header>

<div id="empty">
  <div class="icon">&#9673;</div>
  <p>Waiting for interactions...</p>
  <p style="margin-top:8px;font-size:13px;">Click or type on app.onekeytest.com to see events here</p>
  <p style="margin-top:4px;font-size:12px;color:#484f58;">Supports cross-origin iframes (tradingview, etc.)</p>
</div>

<table id="table" style="display:none;">
  <thead>
    <tr>
      <th style="width:50px">#</th>
      <th style="width:80px">Type</th>
      <th style="width:80px">Frame</th>
      <th style="width:180px">Element</th>
      <th>Content</th>
      <th style="width:90px">Position</th>
      <th style="width:80px">Time</th>
      <th style="width:50px"></th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>

<footer>Press Ctrl+C in terminal to stop recording | Web recorder (port 9223)</footer>

<script>
const tbody = document.getElementById('tbody');
const table = document.getElementById('table');
const empty = document.getElementById('empty');
const stepCount = document.getElementById('stepCount');
const elapsed = document.getElementById('elapsed');
const statusDot = document.getElementById('statusDot');
let count = 0;
const startTime = Date.now();

setInterval(() => {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  elapsed.textContent = m + ':' + s;
}, 1000);

const es = new EventSource('/events');
es.onmessage = (e) => {
  const step = JSON.parse(e.data);
  count++;
  stepCount.textContent = count;
  if (count === 1) { table.style.display = ''; empty.style.display = 'none'; }

  const tr = document.createElement('tr');
  tr.className = 'new-row';
  const isClick = step.type === 'click';
  const isInput = step.type === 'input';
  const isNav = step.type === 'navigation';
  const badgeClass = isClick ? 'badge-click' : isInput ? 'badge-input' : 'badge-nav';
  const label = isClick ? 'CLICK' : isInput ? 'INPUT' : 'NAV';
  const testid = step.testid
    ? '<span class="testid">' + escHtml(step.testid) + '</span>'
    : '<span class="no-testid">no testid</span>';
  const content = isClick
    ? escHtml((step.text || '').substring(0, 60))
    : isInput
    ? 'value="' + escHtml((step.value || '').substring(0, 60)) + '"'
    : escHtml((step.url || '').substring(0, 80));
  const pos = isClick ? step.x + ', ' + step.y : '-';
  const time = new Date(step.time).toLocaleTimeString();
  const frameLabel = step.frameOrigin
    ? '<span class="frame-tag">' + escHtml(step.frameOrigin) + '</span>'
    : 'main';

  tr.setAttribute('data-step', step.step);
  tr.innerHTML =
    '<td>' + step.step + '</td>' +
    '<td><span class="badge ' + badgeClass + '">' + label + '</span></td>' +
    '<td>' + frameLabel + '</td>' +
    '<td>' + escHtml(step.tag || '') + ' ' + testid + '</td>' +
    '<td class="content">' + content + '</td>' +
    '<td class="pos">' + pos + '</td>' +
    '<td class="time">' + time + '</td>' +
    '<td><button class="del-btn" onclick="delStep(' + step.step + ', this)">X</button></td>';
  tbody.appendChild(tr);
  tr.scrollIntoView({ behavior: 'smooth', block: 'end' });
};
es.onerror = () => { statusDot.classList.add('stopped'); };

function delStep(stepNum, btn) {
  const tr = btn.closest('tr');
  tr.classList.add('deleting');
  fetch('/delete?step=' + stepNum, { method: 'POST' }).then(r => {
    if (r.ok) {
      tr.remove();
      count--;
      stepCount.textContent = count;
      const rows = tbody.querySelectorAll('tr');
      rows.forEach((row, i) => {
        const num = i + 1;
        row.children[0].textContent = num;
        row.querySelector('.del-btn').setAttribute('onclick', 'delStep(' + num + ', this)');
      });
    }
    else { tr.classList.remove('deleting'); }
  });
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
</body>
</html>`;

// --- Monitor HTTP server ---
let monitorServer;

function startMonitorServer() {
  monitorServer = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${MONITOR_PORT}`);

    if (url.pathname === '/delete' && req.method === 'POST') {
      const delStep = parseInt(url.searchParams.get('step'));
      const idx = allSteps.findIndex(s => s.step === delStep);
      if (idx !== -1) {
        allSteps.splice(idx, 1);
        allSteps.forEach((s, i) => { s.step = i + 1; });
        stepNum = allSteps.length;
        saveSteps();
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end('{"ok":true}');
      } else {
        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
        res.end('{"error":"not found"}');
      }
      return;
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(':\n\n');
      sseClients.push(res);
      req.on('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(MONITOR_HTML);
  });

  monitorServer.listen(MONITOR_PORT, () => {
    console.log(`  Monitor UI: http://localhost:${MONITOR_PORT}`);
    import('child_process').then(({ exec }) => exec(`open http://localhost:${MONITOR_PORT}`));
  });
}

startMonitorServer();

// ── Inject Listeners into a Frame ────────────────────────────

// The injection script for click & input recording.
// frameOrigin is passed so we know which frame the event came from.
function makeInjectionScript(frameOrigin) {
  return `
    window.__recorderVersion = (window.__recorderVersion || 0) + 1;
    const V = window.__recorderVersion;
    const FRAME_ORIGIN = ${JSON.stringify(frameOrigin)};
    window.__recordedSteps = [];

    // --- Click: debounce 300ms, ignore INPUT/TEXTAREA ---
    let _clickTimer = null;
    let _pendingClick = null;

    document.addEventListener('click', (e) => {
      if (window.__recorderVersion !== V) return;
      const target = e.target;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const closest = target.closest('[data-testid]');
      const r = target.getBoundingClientRect();
      _pendingClick = {
        time: new Date().toISOString(),
        type: 'click',
        tag,
        testid: target.getAttribute('data-testid') || (closest ? closest.getAttribute('data-testid') : ''),
        text: (target.textContent || '').substring(0, 80).trim(),
        placeholder: target.getAttribute('placeholder') || '',
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        frameOrigin: FRAME_ORIGIN
      };
      clearTimeout(_clickTimer);
      _clickTimer = setTimeout(() => {
        if (_pendingClick) {
          window.__recordedSteps.push(_pendingClick);
          console.log('STEP:' + JSON.stringify(_pendingClick));
          _pendingClick = null;
        }
      }, 300);
    }, true);

    // --- Input: debounce 800ms ---
    const _inputTimers = new Map();

    document.addEventListener('input', (e) => {
      if (window.__recorderVersion !== V) return;
      const target = e.target;
      const key = target.getAttribute('data-testid')
        || target.getAttribute('placeholder')
        || target.tagName + '_' + (target.getAttribute('name') || Array.from(target.parentNode?.children || []).indexOf(target));
      clearTimeout(_inputTimers.get(key));
      _inputTimers.set(key, setTimeout(() => {
        _inputTimers.delete(key);
        const step = {
          time: new Date().toISOString(),
          type: 'input',
          tag: target.tagName,
          testid: target.getAttribute('data-testid') || '',
          placeholder: target.getAttribute('placeholder') || '',
          value: (target.value || '').substring(0, 100),
          x: 0,
          y: 0,
          frameOrigin: FRAME_ORIGIN
        };
        window.__recordedSteps.push(step);
        console.log('STEP:' + JSON.stringify(step));
      }, 800));
    }, true);
  `;
}

// Inject listeners into the main page
async function injectListenersToPage(targetPage) {
  try {
    await targetPage.evaluate(makeInjectionScript(''));
    console.log('  [listeners injected → main page]');
  } catch (e) {
    console.log(`  [warn] Failed to inject main page: ${e.message}`);
  }
}

// Inject listeners into all frames (including cross-origin iframes)
async function injectListenersToFrames(targetPage) {
  const frames = targetPage.frames();
  for (const frame of frames) {
    if (frame === targetPage.mainFrame()) continue;
    const frameUrl = frame.url();
    if (!frameUrl || frameUrl === 'about:blank') continue;

    try {
      let origin = '';
      try { origin = new URL(frameUrl).hostname; } catch {}
      await frame.evaluate(makeInjectionScript(origin));
      console.log(`  [listeners injected → iframe: ${origin || frameUrl}]`);
    } catch (e) {
      // Cross-origin frames that block evaluate — try CDP session approach
      console.log(`  [warn] Cannot inject iframe ${frameUrl}: ${e.message}`);
    }
  }
}

// Full injection: main page + all frames
async function injectAllListeners(targetPage) {
  await injectListenersToPage(targetPage);
  await injectListenersToFrames(targetPage);
}

// ── CDP-based iframe monitoring ──────────────────────────────
// For truly cross-origin iframes that block evaluate(),
// we use CDP Target.attachToTarget to get console messages from child frames.

const trackedTargets = new Set();

async function attachCDPFrameMonitoring(targetPage) {
  try {
    const cdpSession = await targetPage.context().newCDPSession(targetPage);

    // Enable Target domain to discover iframe targets
    await cdpSession.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    // Listen for new targets (iframes that load)
    cdpSession.on('Target.attachedToTarget', async (event) => {
      const { sessionId, targetInfo } = event;
      if (trackedTargets.has(targetInfo.targetId)) return;
      trackedTargets.add(targetInfo.targetId);

      const targetUrl = targetInfo.url || '';
      console.log(`  [CDP] Attached to target: ${targetInfo.type} — ${targetUrl}`);

      if (targetInfo.type === 'iframe') {
        let origin = '';
        try { origin = new URL(targetUrl).hostname; } catch {}

        // Try to inject via CDP Runtime.evaluate
        try {
          const childSession = await cdpSession.send('Target.getTargetInfo', { targetId: targetInfo.targetId }).catch(() => null);

          // Enable Runtime to catch console messages from this iframe
          await cdpSession.send('Runtime.enable', {}, sessionId).catch(() => {});

          // Inject our recording script
          await cdpSession.send('Runtime.evaluate', {
            expression: makeInjectionScript(origin),
          }, sessionId).catch(() => {});

          console.log(`  [CDP] Injected listeners into iframe: ${origin}`);
        } catch (e) {
          console.log(`  [CDP] Could not inject into iframe ${origin}: ${e.message}`);
        }
      }
    });

    // Listen for console messages from all targets (including iframes)
    await cdpSession.send('Runtime.enable');

    console.log('  [CDP frame monitoring enabled]');
    return cdpSession;
  } catch (e) {
    console.log(`  [warn] CDP frame monitoring failed: ${e.message}`);
    return null;
  }
}

// ── Wire up event listeners ──────────────────────────────────

await injectAllListeners(page);
const cdpSession = await attachCDPFrameMonitoring(page);

// Re-inject on page load (e.g. SPA navigation, language change)
page.on('load', async () => {
  console.log('  [page reloaded, re-injecting listeners...]');
  await sleep(1000);
  await injectAllListeners(page).catch(() => {});
});

// Re-inject when new frames appear
page.on('frameattached', async (frame) => {
  await sleep(1500); // Wait for frame to load
  const frameUrl = frame.url();
  if (!frameUrl || frameUrl === 'about:blank') return;
  let origin = '';
  try { origin = new URL(frameUrl).hostname; } catch {}
  try {
    await frame.evaluate(makeInjectionScript(origin));
    console.log(`  [listeners injected → new iframe: ${origin}]`);
  } catch (e) {
    console.log(`  [warn] Cannot inject new iframe ${origin}: ${e.message}`);
  }
});

// Record navigation events
page.on('framenavigated', (frame) => {
  if (frame !== page.mainFrame()) return;
  const url = frame.url();
  if (!url || url === 'about:blank') return;
  stepNum++;
  const data = {
    step: stepNum,
    time: new Date().toISOString(),
    type: 'navigation',
    url,
    tag: '',
    testid: '',
    text: '',
    x: 0,
    y: 0,
    frameOrigin: '',
  };
  allSteps.push(data);
  saveSteps();
  broadcast(data);
  console.log(`  [${stepNum}] NAV  ${url}`);
});

// Listen to console from main page + accessible frames
page.on('console', async (msg) => {
  const text = msg.text();
  if (!text.startsWith('STEP:')) return;

  stepNum++;
  const data = JSON.parse(text.substring(5));
  data.step = stepNum;
  allSteps.push(data);

  // Save incrementally
  saveSteps();

  // Push to live monitor
  broadcast(data);

  // Terminal output
  const icon = data.type === 'click' ? 'CLICK' : 'INPUT';
  const testid = data.testid ? `testid="${data.testid}"` : 'no-testid';
  const detail = data.type === 'input' ? `value="${data.value}"` : `text="${(data.text || '').substring(0, 40)}"`;
  const frame = data.frameOrigin ? ` [${data.frameOrigin}]` : '';
  console.log(`  [${stepNum}] ${icon}  ${data.tag}  ${testid}  ${detail}  @(${data.x},${data.y})${frame}`);

  // Screenshot after UI settles
  await sleep(1500);
  const screenshotPath = `${RECORDING_DIR}/step-${String(stepNum).padStart(2, '0')}.png`;
  await page.screenshot({ path: screenshotPath }).catch(() => {});
  data.screenshot = screenshotPath;
  saveSteps();
});

console.log('');
console.log('  +-------------------------------------------------+');
console.log('  |         WEB RECORDING MODE ACTIVE                |');
console.log('  |  Target: app.onekeytest.com (Chrome CDP:9223)    |');
console.log('  |  Iframe support: tradingview + cross-origin      |');
console.log('  |  Press Ctrl+C to stop recording                  |');
console.log('  |  Output: shared/results/recording/               |');
console.log(`  |  Monitor: http://localhost:${MONITOR_PORT}                  |`);
console.log('  +-------------------------------------------------+');
console.log('');

// Keep alive 10 min
const timer = setTimeout(async () => {
  saveSteps();
  console.log(`\n  Recording timeout. Saved ${allSteps.length} steps.`);
  monitorServer?.close();
  if (cdpSession) cdpSession.detach().catch(() => {});
  await browser.close();
}, 600000);

process.on('SIGINT', async () => {
  clearTimeout(timer);
  saveSteps();
  for (const res of sseClients) res.end();
  monitorServer?.close();
  if (cdpSession) cdpSession.detach().catch(() => {});
  console.log(`\n  Recording saved: ${allSteps.length} steps -> ${RECORDING_DIR}/steps.json`);
  console.log(`  Run "node src/recorder/review.mjs" to review.`);
  await browser.close();
  process.exit(0);
});
