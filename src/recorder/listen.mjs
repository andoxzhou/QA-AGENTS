// Recording mode: listens to user clicks/inputs in OneKey, takes screenshots
// Saves steps.json incrementally (no data loss on force-quit)
// Includes live monitor web UI on port 3210 via SSE
// Features: CDP status display, auto-reconnect, reconnect button, no timeout exit
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createServer } from 'http';

const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
const RECORDING_DIR = resolve(import.meta.dirname, '../../shared/results/recording');
mkdirSync(RECORDING_DIR, { recursive: true });

let browser = null;
let page = null;
let stepNum = 0;
const allSteps = [];
const sseClients = [];

// State: 'connecting' | 'recording' | 'paused' | 'disconnected'
let recorderState = 'connecting';
let cdpConnected = false;

function broadcastStep(step) {
  const data = `data: ${JSON.stringify(step)}\n\n`;
  for (const res of sseClients) res.write(data);
}

function broadcastStatus() {
  const msg = { type: 'status', recorderState, cdpConnected, steps: allSteps.length };
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of sseClients) res.write(data);
}

function saveSteps() {
  writeFileSync(`${RECORDING_DIR}/steps.json`, JSON.stringify(allSteps, null, 2));
}

// ── CDP Connection ──────────────────────────────────────────

async function connectCDP() {
  recorderState = 'connecting';
  cdpConnected = false;
  broadcastStatus();

  try {
    // Check CDP is responding
    const resp = await fetch(`${CDP_URL}/json/version`);
    if (!resp.ok) throw new Error('CDP not responding');
  } catch {
    // CDP not responding — try to restart OneKey automatically
    console.log('  [CDP] Not responding, attempting to restart OneKey...');
    broadcastStatus();
    try {
      const { execSync, spawn: spawnProc } = await import('node:child_process');
      const { existsSync } = await import('node:fs');
      const ONEKEY_BIN = '/Applications/OneKey-3.localized/OneKey.app/Contents/MacOS/OneKey';
      execSync('pkill -f "OneKey" 2>/dev/null', { stdio: 'ignore' }).toString();
      await new Promise(r => setTimeout(r, 2000));
      if (existsSync(ONEKEY_BIN)) {
        const child = spawnProc(ONEKEY_BIN, ['--remote-debugging-port=9222'], { detached: true, stdio: 'ignore' });
        child.unref();
        console.log('  [CDP] OneKey restarting...');
        // Wait for CDP to come up
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const r2 = await fetch(`${CDP_URL}/json/version`);
            if (r2.ok) { console.log(`  [CDP] OneKey ready after ${i + 1}s`); break; }
          } catch {}
        }
        // Re-check
        const check = await fetch(`${CDP_URL}/json/version`).catch(() => null);
        if (!check?.ok) {
          recorderState = 'disconnected';
          cdpConnected = false;
          broadcastStatus();
          console.log('  [CDP] OneKey restart failed');
          return false;
        }
      } else {
        recorderState = 'disconnected';
        cdpConnected = false;
        broadcastStatus();
        console.log('  [CDP] OneKey binary not found');
        return false;
      }
    } catch (e) {
      recorderState = 'disconnected';
      cdpConnected = false;
      broadcastStatus();
      console.log('  [CDP] Restart failed:', e.message);
      return false;
    }
  }

  try {
    if (browser) await browser.close().catch(() => {});
    browser = await chromium.connectOverCDP(CDP_URL);
    page = browser.contexts()[0]?.pages()[0];
    if (!page) throw new Error('No page found');

    cdpConnected = true;
    recorderState = 'recording';
    broadcastStatus();

    await injectListeners();

    // Re-inject on page reload
    page.on('load', async () => {
      console.log('  [page reloaded, re-injecting listeners...]');
      await injectListeners().catch(() => {});
    });

    // Listen to console for STEP events
    page.on('console', handleConsoleMessage);

    // Detect disconnect
    browser.on('disconnected', () => {
      console.log('  [CDP] Browser disconnected');
      cdpConnected = false;
      recorderState = 'disconnected';
      broadcastStatus();
    });

    console.log('  [CDP] Connected, recording active');
    return true;
  } catch (e) {
    console.log(`  [CDP] Connection failed: ${e.message}`);
    recorderState = 'disconnected';
    cdpConnected = false;
    broadcastStatus();
    return false;
  }
}

// ── Listener Injection ──────────────────────────────────────

async function injectListeners() {
  await page.evaluate(() => {
    window.__recorderVersion = (window.__recorderVersion || 0) + 1;
    const V = window.__recorderVersion;
    window.__recordedSteps = [];

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
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
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
          y: 0
        };
        window.__recordedSteps.push(step);
        console.log('STEP:' + JSON.stringify(step));
      }, 800));
    }, true);
  });
  console.log('  [listeners injected]');
}

// ── Console Handler ─────────────────────────────────────────

async function handleConsoleMessage(msg) {
  const text = msg.text();
  if (!text.startsWith('STEP:')) return;

  stepNum++;
  const data = JSON.parse(text.substring(5));
  data.step = stepNum;
  allSteps.push(data);

  saveSteps();
  broadcastStep(data);

  const icon = data.type === 'click' ? 'CLICK' : 'INPUT';
  const testid = data.testid ? `testid="${data.testid}"` : 'no-testid';
  const detail = data.type === 'input' ? `value="${data.value}"` : `text="${(data.text || '').substring(0, 40)}"`;
  console.log(`  [${stepNum}] ${icon}  ${data.tag}  ${testid}  ${detail}  @(${data.x},${data.y})`);

  await new Promise(r => setTimeout(r, 1500));
  const screenshotPath = `${RECORDING_DIR}/step-${String(stepNum).padStart(2, '0')}.png`;
  await page.screenshot({ path: screenshotPath }).catch(() => {});
  data.screenshot = screenshotPath;
  saveSteps();
}

// ── CDP Health Check ────────────────────────────────────────

async function checkCDPHealth() {
  try {
    const resp = await fetch(`${CDP_URL}/json/version`);
    const wasConnected = cdpConnected;
    cdpConnected = resp.ok;
    if (!wasConnected && cdpConnected && recorderState === 'disconnected') {
      console.log('  [CDP] Detected recovery, reconnecting...');
      await connectCDP();
    }
    if (wasConnected && !cdpConnected) {
      recorderState = 'disconnected';
    }
    broadcastStatus();
  } catch {
    if (cdpConnected) {
      cdpConnected = false;
      recorderState = 'disconnected';
      broadcastStatus();
    }
  }
}

// Check every 3 seconds
setInterval(checkCDPHealth, 3000);

// ── Monitor UI HTML ─────────────────────────────────────────

const MONITOR_PORT = 3210;

const MONITOR_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recording Monitor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; }
  header { position: sticky; top: 0; z-index: 10; background: #161b22; border-bottom: 1px solid #30363d; padding: 12px 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .status-bar { display: flex; align-items: center; gap: 16px; flex: 1; }
  .status-item { display: flex; align-items: center; gap: 6px; font-size: 13px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .dot.green { background: #3fb950; animation: pulse 1.5s infinite; }
  .dot.red { background: #f85149; animation: none; }
  .dot.yellow { background: #d29922; animation: blink 1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
  .label { color: #8b949e; }
  .value { font-weight: 600; }
  .value.ok { color: #3fb950; }
  .value.err { color: #f85149; }
  .value.warn { color: #d29922; }
  .reconnect-btn { background: #238636; border: 1px solid #2ea043; color: #fff; border-radius: 6px; padding: 6px 16px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
  .reconnect-btn:hover { background: #2ea043; }
  .reconnect-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .reconnect-btn.disconnected { background: #da3633; border-color: #f85149; animation: blink 1.5s infinite; }
  .stats { display: flex; gap: 24px; font-size: 14px; color: #8b949e; }
  .stats span { color: #c9d1d9; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 60px; }
  thead { position: sticky; top: 65px; background: #161b22; z-index: 5; }
  th { text-align: left; padding: 10px 12px; font-size: 12px; text-transform: uppercase; color: #8b949e; border-bottom: 1px solid #30363d; }
  td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr.new-row { animation: highlight 1.5s ease-out; }
  @keyframes highlight { from { background: rgba(56, 139, 253, 0.15); } to { background: transparent; } }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-click { background: #1f6feb33; color: #58a6ff; }
  .badge-input { background: #3fb95033; color: #3fb950; }
  .testid { color: #d2a8ff; font-family: monospace; font-size: 12px; }
  .no-testid { color: #484f58; font-style: italic; }
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
  .toast { position: fixed; top: 80px; right: 24px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px 20px; font-size: 13px; z-index: 100; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.success { border-color: #2ea043; color: #3fb950; }
  .toast.error { border-color: #f85149; color: #f85149; }
</style>
</head>
<body>
<header>
  <div style="font-size:16px;font-weight:600;">Recording Monitor</div>
  <div class="status-bar">
    <div class="status-item">
      <div class="dot" id="cdpDot"></div>
      <span class="label">CDP:</span>
      <span class="value" id="cdpStatus">checking...</span>
    </div>
    <div class="status-item">
      <div class="dot" id="recDot"></div>
      <span class="label">Recorder:</span>
      <span class="value" id="recStatus">connecting...</span>
    </div>
    <div class="stats">
      Steps: <span id="stepCount">0</span>
      &nbsp;&nbsp;
      Elapsed: <span id="elapsed">00:00</span>
    </div>
  </div>
  <button class="reconnect-btn" id="reconnectBtn" onclick="reconnect()">Reconnect</button>
</header>

<div id="toast" class="toast"></div>

<div id="empty">
  <div class="icon">&#9673;</div>
  <p>Waiting for interactions...</p>
  <p style="margin-top:8px;font-size:13px;">Click or type in OneKey app to see events here</p>
</div>

<table id="table" style="display:none;">
  <thead>
    <tr>
      <th style="width:50px">#</th>
      <th style="width:80px">Type</th>
      <th style="width:180px">Element</th>
      <th>Content</th>
      <th style="width:90px">Position</th>
      <th style="width:80px">Time</th>
      <th style="width:50px"></th>
    </tr>
  </thead>
  <tbody id="tbody"></tbody>
</table>

<footer>CDP: <span id="footerCdp">-</span> | Recorder: <span id="footerRec">-</span> | Steps saved to shared/results/recording/steps.json</footer>

<script>
const tbody = document.getElementById('tbody');
const table = document.getElementById('table');
const empty = document.getElementById('empty');
const stepCount = document.getElementById('stepCount');
const elapsed = document.getElementById('elapsed');
const cdpDot = document.getElementById('cdpDot');
const cdpStatus = document.getElementById('cdpStatus');
const recDot = document.getElementById('recDot');
const recStatus = document.getElementById('recStatus');
const reconnectBtn = document.getElementById('reconnectBtn');
const footerCdp = document.getElementById('footerCdp');
const footerRec = document.getElementById('footerRec');
const toast = document.getElementById('toast');
let count = 0;
const startTime = Date.now();
let evtSource = null;

setInterval(() => {
  const sec = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  elapsed.textContent = m + ':' + s;
}, 1000);

function showToast(msg, type) {
  toast.textContent = msg;
  toast.className = 'toast show ' + type;
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function updateStatus(data) {
  // CDP
  cdpDot.className = 'dot ' + (data.cdpConnected ? 'green' : 'red');
  cdpStatus.textContent = data.cdpConnected ? 'Connected' : 'Disconnected';
  cdpStatus.className = 'value ' + (data.cdpConnected ? 'ok' : 'err');
  footerCdp.textContent = data.cdpConnected ? 'OK' : 'DISCONNECTED';

  // Recorder
  const stateMap = {
    recording: { dot: 'green', text: 'Recording', cls: 'ok' },
    connecting: { dot: 'yellow', text: 'Connecting...', cls: 'warn' },
    paused: { dot: 'yellow', text: 'Paused', cls: 'warn' },
    disconnected: { dot: 'red', text: 'Disconnected', cls: 'err' },
  };
  const st = stateMap[data.recorderState] || stateMap.disconnected;
  recDot.className = 'dot ' + st.dot;
  recStatus.textContent = st.text;
  recStatus.className = 'value ' + st.cls;
  footerRec.textContent = st.text;

  // Reconnect button style
  if (data.recorderState === 'disconnected' || !data.cdpConnected) {
    reconnectBtn.className = 'reconnect-btn disconnected';
    reconnectBtn.disabled = false;
  } else {
    reconnectBtn.className = 'reconnect-btn';
    reconnectBtn.disabled = false;
  }
}

function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/events');
  evtSource.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'status') {
      updateStatus(data);
      return;
    }
    // Step event
    count++;
    stepCount.textContent = count;
    if (count === 1) { table.style.display = ''; empty.style.display = 'none'; }

    const tr = document.createElement('tr');
    tr.className = 'new-row';
    const isClick = data.type === 'click';
    const badgeClass = isClick ? 'badge-click' : 'badge-input';
    const label = isClick ? 'CLICK' : 'INPUT';
    const testid = data.testid
      ? '<span class="testid">' + escHtml(data.testid) + '</span>'
      : '<span class="no-testid">no testid</span>';
    const content = isClick
      ? escHtml((data.text || '').substring(0, 60))
      : 'value="' + escHtml((data.value || '').substring(0, 60)) + '"';
    const pos = isClick ? data.x + ', ' + data.y : '-';
    const time = new Date(data.time).toLocaleTimeString();

    tr.setAttribute('data-step', data.step);
    tr.innerHTML =
      '<td>' + data.step + '</td>' +
      '<td><span class="badge ' + badgeClass + '">' + label + '</span></td>' +
      '<td>' + escHtml(data.tag) + ' ' + testid + '</td>' +
      '<td class="content">' + content + '</td>' +
      '<td class="pos">' + pos + '</td>' +
      '<td class="time">' + time + '</td>' +
      '<td><button class="del-btn" onclick="delStep(' + data.step + ', this)">X</button></td>';
    tbody.appendChild(tr);
    tr.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };
  evtSource.onerror = () => {
    recDot.className = 'dot red';
    recStatus.textContent = 'SSE Lost';
    recStatus.className = 'value err';
    // Auto-retry SSE after 3 seconds
    setTimeout(connectSSE, 3000);
  };
}

function reconnect() {
  reconnectBtn.disabled = true;
  reconnectBtn.textContent = 'Reconnecting...';
  fetch('/reconnect', { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      reconnectBtn.textContent = 'Reconnect';
      reconnectBtn.disabled = false;
      if (data.ok) {
        showToast('Reconnected successfully', 'success');
      } else {
        showToast('Reconnect failed: ' + (data.error || 'unknown'), 'error');
      }
    })
    .catch(() => {
      reconnectBtn.textContent = 'Reconnect';
      reconnectBtn.disabled = false;
      showToast('Reconnect request failed', 'error');
    });
}

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

connectSSE();
</script>
</body>
</html>`;

// ── Monitor HTTP Server ─────────────────────────────────────

let monitorServer;

function startMonitorServer() {
  monitorServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${MONITOR_PORT}`);

    if (url.pathname === '/reconnect' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      try {
        const ok = await connectCDP();
        res.end(JSON.stringify({ ok }));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

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
      // Send current status immediately
      const statusMsg = { type: 'status', recorderState, cdpConnected, steps: allSteps.length };
      res.write(`data: ${JSON.stringify(statusMsg)}\n\n`);
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
  });
}

// ── Startup ─────────────────────────────────────────────────

startMonitorServer();
await connectCDP();

console.log('');
console.log('  ┌─────────────────────────────────────────────┐');
console.log('  │           RECORDING MODE ACTIVE              │');
console.log('  │  请在 OneKey 上操作，每次点击/输入自动记录    │');
console.log('  │  按 Ctrl+C 结束录制                          │');
console.log('  │  录制结果: shared/results/recording/          │');
console.log(`  │  实时监控: http://localhost:${MONITOR_PORT}            │`);
console.log('  │  CDP 断开后会自动检测并可一键重连             │');
console.log('  └─────────────────────────────────────────────┘');
console.log('');

// No timeout exit — keep running indefinitely until Ctrl+C
process.on('SIGINT', async () => {
  saveSteps();
  for (const res of sseClients) res.end();
  monitorServer?.close();
  console.log(`\n  Recording saved: ${allSteps.length} steps → ${RECORDING_DIR}/steps.json`);
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
});
