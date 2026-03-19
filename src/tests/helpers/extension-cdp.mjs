// Extension CDP connection helper
// Launches Chrome with the OneKey browser extension loaded via CDP.
// Extension ID and path are auto-detected or configurable via env vars.

import { chromium } from 'playwright-core';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const DEFAULT_EXT_ID = 'jnmbobjmhlngoefaiojfljckilhhlhcj';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9224';
const TMP_PROFILE = '/tmp/chrome-ext-cdp-profile';

// ── Public Getters ───────────────────────────────────────────

export function getExtensionId() {
  return process.env.ONEKEY_EXT_ID || DEFAULT_EXT_ID;
}

/**
 * Resolve the extension directory path.
 * Priority: ONEKEY_EXT_PATH env → auto-detect from Chrome profiles.
 */
export function getExtensionPath() {
  if (process.env.ONEKEY_EXT_PATH) {
    const p = process.env.ONEKEY_EXT_PATH;
    if (!existsSync(p)) throw new Error(`ONEKEY_EXT_PATH does not exist: ${p}`);
    return p;
  }
  return autoDetectExtensionPath(getExtensionId());
}

// ── Auto-Detection ───────────────────────────────────────────

function autoDetectExtensionPath(extId) {
  const chromeDir = `${process.env.HOME}/Library/Application Support/Google/Chrome`;
  if (!existsSync(chromeDir)) {
    throw new Error(`Chrome user data dir not found: ${chromeDir}`);
  }

  const entries = readdirSync(chromeDir);
  // Scan "Profile N" dirs and "Default"
  const profileDirs = [
    ...entries.filter(e => e.startsWith('Profile ')).sort(),
    'Default',
  ];

  for (const profileName of profileDirs) {
    const extBase = join(chromeDir, profileName, 'Extensions', extId);
    if (!existsSync(extBase)) continue;

    const versions = readdirSync(extBase)
      .filter(v => existsSync(join(extBase, v, 'manifest.json')))
      .sort();

    if (versions.length > 0) {
      const latest = versions[versions.length - 1];
      const fullPath = join(extBase, latest);
      console.log(`  Auto-detected extension: ${profileName}/${extId}/${latest}`);
      return fullPath;
    }
  }

  throw new Error(
    `OneKey extension (${extId}) not found in any Chrome profile.\n` +
    `Set ONEKEY_EXT_PATH env var to the extension directory.`
  );
}

// ── Chrome Data Dir Copy ─────────────────────────────────────
// Chrome Web Store extensions require the FULL Chrome data directory
// (not just a profile subdirectory) to preserve extension verification state.

function getActiveProfileName() {
  const chromeDir = `${process.env.HOME}/Library/Application Support/Google/Chrome`;
  if (!existsSync(chromeDir)) return 'Default';
  const entries = readdirSync(chromeDir);
  const profiles = entries.filter(e => e.startsWith('Profile ')).sort();
  return profiles.length > 0 ? profiles[profiles.length - 1] : 'Default';
}

function ensureTempProfile() {
  if (existsSync(`${TMP_PROFILE}/Local State`)) return;

  const chromeDir = `${process.env.HOME}/Library/Application Support/Google/Chrome`;
  if (!existsSync(chromeDir)) return;

  console.log('  Copying full Chrome data dir (preserves extension state)...');
  execSync(`cp -a "${chromeDir}" "${TMP_PROFILE}"`, { stdio: 'ignore' });
  // Remove lock files to avoid "SingletonLock" conflict
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { execSync(`rm -f "${TMP_PROFILE}/${lock}"`, { stdio: 'ignore' }); } catch {}
  }
  console.log('  Chrome data dir copied to ' + TMP_PROFILE);
}

// ── Ensure Chrome Running ────────────────────────────────────

const getCdpUrl = () => process.env.EXT_CDP_URL || DEFAULT_CDP_URL;

export async function ensureExtensionRunning() {
  const cdpUrl = getCdpUrl();

  // Check if already running
  for (let i = 0; i < 2; i++) {
    try {
      const resp = await fetch(`${cdpUrl}/json/version`);
      if (resp.ok) { console.log('  Extension Chrome CDP ready.'); return; }
    } catch {}
    if (i === 0) await sleep(500);
  }

  console.log('  Extension Chrome CDP not responding, launching Chrome...');

  const chromePaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const chromeBin = chromePaths.find(p => existsSync(p));
  if (!chromeBin) {
    throw new Error(
      'Chrome not found. Please start Chrome manually with:\n' +
      `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9224 --load-extension=<ext-path>`
    );
  }

  const port = new URL(cdpUrl).port || '9224';

  // Copy full Chrome profile (with installed extensions) to temp dir.
  // Chrome Web Store extensions are signed and cannot be loaded via --load-extension.
  // Instead we reuse the profile that already has the extension installed.
  ensureTempProfile();
  const profileName = getActiveProfileName();

  const child = spawn(chromeBin, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${TMP_PROFILE}`,
    `--profile-directory=${profileName}`,
    '--no-first-run',
    '--disable-sync',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  // Wait for CDP to become available
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const resp = await fetch(`${cdpUrl}/json/version`);
      if (resp.ok) {
        console.log(`  Extension Chrome ready after ${i + 1}s`);
        return;
      }
    } catch {}
  }
  throw new Error('Extension Chrome failed to start within 30s');
}

// ── Connect & Find Extension Page ────────────────────────────

export async function connectExtensionCDP() {
  const cdpUrl = getCdpUrl();
  const extId = getExtensionId();

  await ensureExtensionRunning();

  const browser = await chromium.connectOverCDP(cdpUrl);
  const contexts = browser.contexts();

  // Look for an existing extension page
  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      const url = p.url();
      if (url.startsWith(`chrome-extension://${extId}/`)) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  // If no extension page found, try to open one
  if (!page) {
    console.log('  No extension page found, opening ui-expand-tab.html...');
    const allPages = contexts.flatMap(c => c.pages());
    const anyPage = allPages.find(p => !p.url().startsWith('chrome://'));

    if (anyPage) {
      // Try navigating to the extension page
      await anyPage.goto(`chrome-extension://${extId}/ui-expand-tab.html`);
      await sleep(5000);
      page = anyPage;
    } else {
      // Create a new page
      const ctx = contexts[0] || await browser.newContext();
      page = await ctx.newPage();
      await page.goto(`chrome-extension://${extId}/ui-expand-tab.html`);
      await sleep(5000);
    }

    // Re-scan in case the extension opened in a different tab
    if (!page.url().startsWith(`chrome-extension://${extId}/`)) {
      for (const ctx of browser.contexts()) {
        for (const p of ctx.pages()) {
          if (p.url().startsWith(`chrome-extension://${extId}/`)) {
            page = p;
            break;
          }
        }
        if (page.url().startsWith(`chrome-extension://${extId}/`)) break;
      }
    }
  }

  console.log(`  Extension page: ${page.url()}`);
  return { browser, page };
}
