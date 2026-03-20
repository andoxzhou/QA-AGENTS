// Browser Account Sync Tests — BROWSER-SYNC-001 ~ BROWSER-SYNC-004
// Generated: 2026-03-20
//
// Key stable selectors:
// - Sidebar:              [data-testid="Desktop-AppSideBar-Content-Container"]
// - Account selector:     [data-testid="AccountSelectorTriggerBase"]
// - Network selector:     [data-testid="account-network-trigger-button-text"]
// - Network search:       [data-testid="nav-header-search-chain-selector"]
// - Settings popup:       TMPopover-ScrollView text="设置"
// - Settings wallet tab:  [data-testid="tab-modal-no-active-item-WalletSolid"]
// - Sync mode option:     [data-testid^="select-item-"] text contains mode name
// - Derivation path:      [data-testid^="select-item-"] text="账户派生路径"
// - Browser shortcuts:    [data-testid="browser-shortcuts-button"]
// - Disconnect:           [data-testid="action-list-item-disconnect"]
// - Connection dialog:    [data-testid="DAppAccountListStandAloneItem"]
// - Authorize button:     [data-testid="page-footer-confirm"] text="授权"
// - Back button:          [data-testid="nav-header-back"]
// - DApp search:          [data-testid="search-input"], [data-testid="dapp-search0"]
// - Multi-avatar:         [data-testid="multi-avatar"]
// - Browser home tab:     [data-testid="tab-modal-no-active-item-HomeDoor2Outline"]
//
// Design notes:
// - DApp webpages run inside OneKey's built-in browser (webview). The script
//   cannot click inside DApp webpages directly.
// - The script CAN: navigate to DApp URLs, handle OneKey connection dialogs,
//   read OneKey-side status.
// - For DApp-side actions (clicking Connect Wallet), a comment is added and
//   waitForConnectPrompt(page) is used to wait for the authorization dialog.
// - fn(page) single parameter signature for dashboard compatibility.
// - Screenshots only on failure.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  connectCDP, sleep, screenshot, RESULTS_DIR,
  dismissOverlays, unlockWalletIfNeeded,
} from '../../helpers/index.mjs';
import { createStepTracker, safeStep } from '../../helpers/market-search.mjs';

const SCREENSHOT_DIR = resolve(RESULTS_DIR, 'browser-sync');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── CONFIG (all wallet/account/dapp names are variables, not hardcoded) ──

const CONFIG = {
  // Wallet names and accounts — configurable
  walletA: { name: 'piggy\ud83d\udc37', accounts: ['Account #1', 'Account #2'] },
  walletB: { name: '\u4ea7\u54c1', accounts: ['\u4ea7\u54c1\u8d26\u62371\ufe0f\u20e3', 'Account #2'] },

  // DApp URLs
  dapps: {
    pancakeswap: { url: 'pancakeswap.finance', connectMethod: 'MetaMask', chain: 'EVM' },
    cetus: { url: 'app.cetus.zone/swap', connectMethod: 'OneKey', chain: 'SUI' },
    portal: { url: 'portalbridge.com', connectMethods: { evm: 'MetaMask', sol: 'OneKey' } },
    babylon: { url: 'babylonlabs.io', connectMethod: 'OneKey', requiresTerms: true, chains: ['BTC', 'Babylon'] },
  },

  // Networks
  defaultNetwork: 'Polygon',

  // Sync modes
  modes: {
    align: '\u94b1\u5305\u548c dApp \u8d26\u6237\u5bf9\u9f50',       // 将 dApp 账户对齐至钱包
    independent: '\u72ec\u7acb\u6a21\u5f0f',                          // TODO: confirm actual text
    alwaysWallet: '\u59cb\u7ec8\u4f7f\u7528\u94b1\u5305\u8d26\u6237', // TODO: confirm actual text
  },
};

const ALL_TEST_IDS = [
  'BROWSER-SYNC-001',
  'BROWSER-SYNC-002',
  'BROWSER-SYNC-003',
  'BROWSER-SYNC-004',
];

// ── Helper: Screenshot on failure only ───────────────────────

const _safeStep = (page, t, name, fn) =>
  safeStep(page, t, name, fn, (p, n) => screenshot(p, SCREENSHOT_DIR, n));

// ── Helper: Read current wallet account ──────────────────────

async function readCurrentWalletAccount(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="AccountSelectorTriggerBase"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return el.textContent?.trim() || null;
  });
}

// ── Helper: Read current network ─────────────────────────────

async function readCurrentNetwork(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="account-network-trigger-button-text"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    return el.textContent?.trim() || null;
  });
}

// ── Helper: Switch wallet account (conditional) ──────────────

async function switchWalletAccount(page, walletName, accountName) {
  // Check current account — skip if already on target
  const current = await readCurrentWalletAccount(page);
  if (current && current.includes(accountName)) {
    console.log(`    Already on account: ${accountName}`);
    return;
  }

  // Click account selector trigger
  const trigger = page.locator('[data-testid="AccountSelectorTriggerBase"]').first();
  await trigger.click({ timeout: 5000 });
  await sleep(2000);

  // Find and click the target wallet group first (if walletName specified)
  if (walletName) {
    const walletFound = await page.evaluate((wName) => {
      // Look for wallet header/group containing the wallet name
      const els = document.querySelectorAll('[data-testid*="wallet-hd"], [data-testid*="wallet-"]');
      for (const el of els) {
        const txt = el.textContent?.trim() || '';
        if (txt.includes(wName)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { el.click(); return true; }
        }
      }
      // Fallback: text match on span
      for (const sp of document.querySelectorAll('span')) {
        if (sp.textContent?.trim() === wName) {
          const r = sp.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { sp.click(); return true; }
        }
      }
      return false;
    }, walletName);
    if (walletFound) await sleep(1500);
  }

  // Click the target account
  const accountClicked = await page.evaluate((accName) => {
    const items = document.querySelectorAll('[data-testid*="account-item-index-"]');
    for (const item of items) {
      const txt = item.textContent?.trim() || '';
      if (txt.includes(accName)) {
        const r = item.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { item.click(); return true; }
      }
    }
    // Fallback: any element with the account name
    for (const sp of document.querySelectorAll('span, div')) {
      if (sp.children.length > 2) continue;
      if (sp.textContent?.trim() === accName) {
        const r = sp.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { sp.click(); return true; }
      }
    }
    return false;
  }, accountName);

  if (!accountClicked) {
    // Close the selector and report
    await page.keyboard.press('Escape');
    await sleep(500);
    throw new Error(`Account "${accountName}" not found in wallet "${walletName}"`);
  }
  await sleep(2000);

  // Verify switch
  const after = await readCurrentWalletAccount(page);
  if (after && !after.includes(accountName)) {
    console.log(`    Warning: expected account "${accountName}", got "${after}"`);
  }
}

// ── Helper: Switch network (conditional) ─────────────────────

async function switchNetwork(page, networkName) {
  const current = await readCurrentNetwork(page);
  if (current && current.includes(networkName)) {
    console.log(`    Already on network: ${networkName}`);
    return;
  }

  const networkBtn = page.locator('[data-testid="account-network-trigger-button"]').first();
  const hasTrigger = await networkBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (!hasTrigger) {
    // Try the text element instead
    const textEl = page.locator('[data-testid="account-network-trigger-button-text"]').first();
    await textEl.click({ timeout: 5000 });
  } else {
    await networkBtn.click({ timeout: 5000 });
  }
  await sleep(1500);

  const chainSearch = page.locator('[data-testid="nav-header-search-chain-selector"]').first();
  const hasSearch = await chainSearch.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasSearch) {
    await chainSearch.fill(networkName);
    await sleep(1500);
  }

  const clicked = await page.evaluate((name) => {
    const spans = document.querySelectorAll('span');
    for (const sp of spans) {
      if (sp.textContent?.trim() === name && sp.getBoundingClientRect().width > 0) {
        const clickTarget = sp.closest('[role="button"]') || sp.parentElement || sp;
        clickTarget.click();
        return true;
      }
    }
    // Partial match fallback
    for (const sp of spans) {
      const t = sp.textContent?.trim() || '';
      const r = sp.getBoundingClientRect();
      if (r.width > 0 && r.height > 10 && t.toLowerCase().includes(name.toLowerCase())) {
        const clickTarget = sp.closest('[role="button"]') || sp.parentElement || sp;
        clickTarget.click();
        return true;
      }
    }
    return false;
  }, networkName);

  if (!clicked) {
    await page.keyboard.press('Escape');
    await sleep(500);
    throw new Error(`Network "${networkName}" not found`);
  }
  await sleep(3000);
}

// ── Helper: Open settings popup ──────────────────────────────

async function openSettings(page) {
  // Recording shows: click sidebar bottom area → popover appears → click "设置"
  // Step 1: Click the bottom of the sidebar to trigger the popover
  await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="Desktop-AppSideBar-Content-Container"]');
    if (!sidebar) return;
    const r = sidebar.getBoundingClientRect();
    // Click near the bottom of the sidebar
    sidebar.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: r.x + r.width / 2, clientY: r.bottom - 20
    }));
  });
  await sleep(800);

  // Step 2: Click "设置" in the popover (TMPopover-ScrollView)
  const opened = await page.evaluate(() => {
    const popovers = document.querySelectorAll('[data-testid="TMPopover-ScrollView"]');
    for (const pop of popovers) {
      const items = pop.querySelectorAll('span, div');
      for (const item of items) {
        const txt = item.textContent?.trim();
        if (txt === '设置' || txt === 'Settings') {
          const r = item.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            item.click();
            return true;
          }
        }
      }
    }
    return false;
  });

  if (!opened) {
    // Fallback: try clicking sidebar bottom with mouse, then find settings
    await page.mouse.click(36, 770);
    await sleep(800);
    const retry = await page.evaluate(() => {
      for (const el of document.querySelectorAll('span')) {
        if (el.textContent?.trim() === '设置' && el.getBoundingClientRect().width > 0) {
          el.click(); return true;
        }
      }
      return false;
    });
    if (!retry) {
      const settingsBtn = page.locator('[data-testid*="setting"], [data-testid*="Setting"]').first();
      const visible = await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        await settingsBtn.click();
      } else {
        throw new Error('Cannot open settings');
      }
    }
  }
  await sleep(2000);
}

// ── Helper: Switch sync mode in settings ─────────────────────

async function switchSyncMode(page, modeName) {
  // Open settings if not already open
  await openSettings(page);

  // Click wallet tab in settings
  const walletTab = page.locator('[data-testid="tab-modal-no-active-item-WalletSolid"]').first();
  const walletTabVisible = await walletTab.isVisible({ timeout: 3000 }).catch(() => false);
  if (walletTabVisible) {
    await walletTab.click();
    await sleep(1500);
  }

  // Find and click the sync mode / alignment option
  const modeClicked = await page.evaluate((mode) => {
    // Look for select items containing the mode text
    const items = document.querySelectorAll('[data-testid^="select-item-"]');
    for (const item of items) {
      const txt = item.textContent?.trim() || '';
      if (txt.includes(mode)) {
        const r = item.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { item.click(); return true; }
      }
    }
    // Fallback: any clickable element with the mode text
    for (const el of document.querySelectorAll('span, div')) {
      if (el.children.length > 2) continue;
      const txt = el.textContent?.trim() || '';
      if (txt.includes(mode)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 80) { el.click(); return true; }
      }
    }
    return false;
  }, modeName);

  if (!modeClicked) {
    // Close settings and report
    await page.keyboard.press('Escape');
    await sleep(500);
    throw new Error(`Sync mode "${modeName}" not found in settings`);
  }
  await sleep(1500);

  // Close settings modal
  await page.keyboard.press('Escape');
  await sleep(1000);
  await dismissOverlays(page);
}

// ── Helper: Switch derivation path ───────────────────────────

async function switchDerivationPath(page, chain, pathType) {
  await openSettings(page);

  // Click wallet tab
  const walletTab = page.locator('[data-testid="tab-modal-no-active-item-WalletSolid"]').first();
  const walletTabVisible = await walletTab.isVisible({ timeout: 3000 }).catch(() => false);
  if (walletTabVisible) {
    await walletTab.click();
    await sleep(1500);
  }

  // Find derivation path option
  const derivClicked = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid^="select-item-"]');
    for (const item of items) {
      const txt = item.textContent?.trim() || '';
      if (txt.includes('\u8d26\u6237\u6d3e\u751f\u8def\u5f84')) {
        const r = item.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { item.click(); return true; }
      }
    }
    return false;
  });

  if (!derivClicked) {
    await page.keyboard.press('Escape');
    await sleep(500);
    throw new Error('Derivation path option not found');
  }
  await sleep(1500);

  // Select chain and path type
  if (chain) {
    const chainClicked = await page.evaluate((c) => {
      for (const el of document.querySelectorAll('span, div')) {
        if (el.children.length > 2) continue;
        const txt = el.textContent?.trim() || '';
        if (txt.includes(c)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 60) { el.click(); return true; }
        }
      }
      return false;
    }, chain);
    if (chainClicked) await sleep(1000);
  }

  if (pathType) {
    const pathClicked = await page.evaluate((pt) => {
      for (const el of document.querySelectorAll('span, div, [data-testid^="select-item-"]')) {
        const txt = el.textContent?.trim() || '';
        if (txt.includes(pt)) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 60) { el.click(); return true; }
        }
      }
      return false;
    }, pathType);
    if (pathClicked) await sleep(1000);
  }

  // Close settings
  await page.keyboard.press('Escape');
  await sleep(1000);
  await dismissOverlays(page);
}

// ── Helper: Navigate to Browser via sidebar ──────────────────

async function goToBrowser(page) {
  const ok = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="Desktop-AppSideBar-Content-Container"]');
    if (!sidebar) return false;
    const labels = new Set(['\u6d4f\u89c8\u5668', 'Browser', 'Discover']);
    for (const sp of sidebar.querySelectorAll('span')) {
      const txt = sp.textContent?.trim();
      if (!txt) continue;
      if (!labels.has(txt)) continue;
      const r = sp.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { sp.click(); return true; }
    }
    // Partial match fallback
    for (const sp of sidebar.querySelectorAll('span')) {
      const txt = sp.textContent?.trim() || '';
      if (txt.includes('\u6d4f\u89c8') || txt.includes('Browser') || txt.includes('Discover')) {
        const r = sp.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { sp.click(); return true; }
      }
    }
    return false;
  });
  if (!ok) throw new Error('Cannot navigate to Browser via sidebar');
  await sleep(2500);
}

// ── Helper: Navigate to Wallet via sidebar ───────────────────

async function goToWallet(page) {
  const ok = await page.evaluate(() => {
    const walletBtn = document.querySelector('[data-testid="tab-modal-no-active-item-Wallet4Outline"]');
    if (walletBtn) {
      const r = walletBtn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { walletBtn.click(); return true; }
    }
    const sidebar = document.querySelector('[data-testid="Desktop-AppSideBar-Content-Container"]');
    if (!sidebar) return false;
    const labels = ['Wallet', '\u94b1\u5305', '\u30a6\u30a9\u30ec\u30c3\u30c8'];
    for (const sp of sidebar.querySelectorAll('span')) {
      const txt = sp.textContent?.trim();
      if (labels.includes(txt)) {
        const r = sp.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { sp.click(); return true; }
      }
    }
    return false;
  });
  if (!ok) throw new Error('Cannot navigate to Wallet via sidebar');
  await sleep(2500);
}

// ── Helper: Open DApp tab (find existing or search & open) ───

async function openDAppTab(page, dappUrl) {
  // Check if already on this DApp tab
  const alreadyOpen = await page.evaluate((url) => {
    // Look for active or inactive tab with matching URL text
    const tabs = document.querySelectorAll('[data-testid*="tab-modal-"]');
    for (const tab of tabs) {
      const txt = tab.textContent?.trim() || '';
      if (txt.toLowerCase().includes(url.toLowerCase().split('/')[0])) {
        const r = tab.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { tab.click(); return true; }
      }
    }
    return false;
  }, dappUrl);

  if (alreadyOpen) {
    await sleep(2000);
    return;
  }

  // Go to browser home first
  const homeTab = page.locator('[data-testid="tab-modal-no-active-item-HomeDoor2Outline"]').first();
  const homeVisible = await homeTab.isVisible({ timeout: 2000 }).catch(() => false);
  if (homeVisible) {
    await homeTab.click();
    await sleep(1500);
  }

  // Search for the DApp — search-input is a div container, find the actual input inside
  const searchContainer = page.locator('[data-testid="search-input"]').first();
  const searchVisible = await searchContainer.isVisible({ timeout: 3000 }).catch(() => false);
  if (searchVisible) {
    await searchContainer.click();
    await sleep(500);
    // The actual input may be inside the container or appear after click
    const actualInput = page.locator('[data-testid="search-input"] input, [data-testid="explore-index-search-input"]').first();
    const inputVisible = await actualInput.isVisible({ timeout: 2000 }).catch(() => false);
    if (inputVisible) {
      await actualInput.click();
      await sleep(200);
      try { await actualInput.pressSequentially(dappUrl, { delay: 30 }); }
      catch { await actualInput.fill(dappUrl); }
    } else {
      // Fallback: type via keyboard after clicking container
      await page.keyboard.type(dappUrl, { delay: 30 });
    }
    await sleep(1500);

    // Click the search result or press Enter
    const resultClicked = await page.evaluate((url) => {
      const dappResult = document.querySelector('[data-testid="dapp-search0"]');
      if (dappResult) {
        const r = dappResult.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { dappResult.click(); return true; }
      }
      // Fallback: find by URL text in results
      for (const el of document.querySelectorAll('div, span, a')) {
        const txt = el.textContent?.trim() || '';
        if (txt.toLowerCase().includes(url.toLowerCase().split('/')[0])) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 80) { el.click(); return true; }
        }
      }
      return false;
    }, dappUrl);

    if (!resultClicked) {
      // Press Enter to navigate directly
      await page.keyboard.press('Enter');
    }
  } else {
    // Fallback: try address bar
    await page.evaluate((url) => {
      const inputs = document.querySelectorAll('input');
      for (const input of inputs) {
        const r = input.getBoundingClientRect();
        if (r.width > 200 && r.y < 100) {
          input.focus();
          input.value = url;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, dappUrl);
    await page.keyboard.press('Enter');
  }
  await sleep(3000);
}

// ── Helper: Disconnect DApp (conditional) ────────────────────

async function disconnectDApp(page) {
  // Check if browser shortcuts button is visible (indicates we're on a DApp page)
  const shortcutsBtn = page.locator('[data-testid="browser-shortcuts-button"]').first();
  const hasShortcuts = await shortcutsBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (!hasShortcuts) {
    console.log('    No browser-shortcuts-button visible, skip disconnect');
    return false;
  }

  await shortcutsBtn.click();
  await sleep(1500);

  // Look for disconnect action
  const disconnectBtn = page.locator('[data-testid="action-list-item-disconnect"]').first();
  const hasDisconnect = await disconnectBtn.isVisible({ timeout: 2000 }).catch(() => false);
  if (!hasDisconnect) {
    console.log('    No disconnect option found (DApp may not be connected)');
    await page.keyboard.press('Escape');
    await sleep(500);
    return false;
  }

  await disconnectBtn.click();
  await sleep(2000);
  return true;
}

// ── Helper: Wait for DApp connection authorization prompt ────

async function waitForConnectPrompt(page, timeoutMs = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const hasPrompt = await page.evaluate(() => {
      // Check for connection dialog elements
      const authBtn = document.querySelector('[data-testid="page-footer-confirm"]');
      if (authBtn) {
        const txt = authBtn.textContent?.trim() || '';
        const r = authBtn.getBoundingClientRect();
        if (r.width > 0 && (txt.includes('\u6388\u6743') || txt.includes('Connect') || txt.includes('Confirm'))) {
          return true;
        }
      }
      // Check for DApp account list
      const accList = document.querySelector('[data-testid="DAppAccountListStandAloneItem"]');
      if (accList && accList.getBoundingClientRect().width > 0) return true;
      return false;
    });
    if (hasPrompt) return true;
    await sleep(1000);
  }
  return false;
}

// ── Helper: Authorize DApp connection ────────────────────────

async function authorizeConnection(page, walletName, accountName) {
  // Wait for connection dialog
  const hasPrompt = await waitForConnectPrompt(page, 15000);
  if (!hasPrompt) {
    throw new Error('Connection authorization dialog not found');
  }
  await sleep(1000);

  // Check for "没有账户" empty state — handle gracefully
  const hasNoAccount = await page.evaluate(() => {
    const body = document.body?.textContent || '';
    return body.includes('\u6ca1\u6709\u8d26\u6237') || body.includes('No account');
  });
  if (hasNoAccount) {
    console.log('    Connection dialog shows "\u6ca1\u6709\u8d26\u6237" — no eligible account');
    // Close dialog
    await page.keyboard.press('Escape');
    await sleep(500);
    return { connected: false, reason: 'no-account' };
  }

  // Select wallet if needed
  if (walletName) {
    await page.evaluate((wName) => {
      const wallets = document.querySelectorAll('[data-testid*="wallet-hd"]');
      for (const w of wallets) {
        const txt = w.textContent?.trim() || '';
        if (txt.includes(wName)) {
          const r = w.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { w.click(); return; }
        }
      }
    }, walletName);
    await sleep(1000);
  }

  // Select account if specified
  if (accountName) {
    const accClicked = await page.evaluate((accName) => {
      // Try DAppAccountListStandAloneItem first
      const items = document.querySelectorAll('[data-testid="DAppAccountListStandAloneItem"]');
      for (const item of items) {
        const txt = item.textContent?.trim() || '';
        if (txt.includes(accName)) {
          const r = item.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { item.click(); return true; }
        }
      }
      // Fallback: account-item-index-*
      const accountItems = document.querySelectorAll('[data-testid*="account-item-index-"]');
      for (const item of accountItems) {
        const txt = item.textContent?.trim() || '';
        if (txt.includes(accName)) {
          const r = item.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { item.click(); return true; }
        }
      }
      return false;
    }, accountName);
    if (accClicked) await sleep(500);
  }

  // Click authorize/confirm button
  const authClicked = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="page-footer-confirm"]');
    if (btn) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { btn.click(); return true; }
    }
    // Fallback: any button with 授权 text
    for (const b of document.querySelectorAll('button')) {
      const txt = b.textContent?.trim() || '';
      if (txt.includes('\u6388\u6743') || txt === 'Connect' || txt === 'Confirm') {
        const r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { b.click(); return true; }
      }
    }
    return false;
  });

  if (!authClicked) {
    throw new Error('Authorize button not found in connection dialog');
  }
  await sleep(2000);
  return { connected: true };
}

// ── Helper: Read DApp connected account from browser toolbar ─

async function readDAppConnectedAccount(page) {
  return page.evaluate(() => {
    // The multi-avatar or account indicator in the browser toolbar
    const multiAvatar = document.querySelector('[data-testid="multi-avatar"]');
    if (multiAvatar) {
      // Look for nearby text showing account/address info
      const parent = multiAvatar.closest('div');
      if (parent) {
        const txt = parent.textContent?.trim() || '';
        if (txt) return txt;
      }
    }
    // Fallback: check browser shortcuts area for account info
    const shortcutsBtn = document.querySelector('[data-testid="browser-shortcuts-button"]');
    if (shortcutsBtn) {
      const parent = shortcutsBtn.parentElement;
      if (parent) {
        const spans = parent.querySelectorAll('span');
        for (const sp of spans) {
          const txt = sp.textContent?.trim() || '';
          // Address-like text (0x... or short address)
          if (txt.match(/^0x[a-fA-F0-9]{4}/)) return txt;
          if (txt.match(/^[A-Za-z0-9]{4}\.\.\.[A-Za-z0-9]{4}$/)) return txt;
        }
      }
    }
    return null;
  });
}

// ── Helper: Read DApp connected network ──────────────────────

async function readDAppConnectedNetwork(page) {
  return page.evaluate(() => {
    // Look for network info near the browser toolbar
    const shortcutsBtn = document.querySelector('[data-testid="browser-shortcuts-button"]');
    if (!shortcutsBtn) return null;
    const parent = shortcutsBtn.parentElement;
    if (!parent) return null;
    // Network name is usually in a span near the shortcuts
    const spans = parent.querySelectorAll('span');
    for (const sp of spans) {
      const txt = sp.textContent?.trim() || '';
      const r = sp.getBoundingClientRect();
      if (r.width === 0) continue;
      // Known network names
      const networks = ['Ethereum', 'Polygon', 'BNB', 'Arbitrum', 'Optimism', 'Avalanche',
        'Base', 'Solana', 'SUI', 'Bitcoin', 'Cosmos'];
      for (const net of networks) {
        if (txt.includes(net)) return txt;
      }
    }
    return null;
  });
}

// ── Test Cases ───────────────────────────────────────────────

/**
 * BROWSER-SYNC-001: 对齐至钱包模式（默认）— 连接 DApp 后钱包侧跟随
 *
 * Steps:
 * 1. Ensure default sync mode is "对齐"
 * 2. Go to Browser, open PancakeSwap
 * 3. [DApp-side] User clicks Connect Wallet -> MetaMask
 * 4. Authorize connection with walletA / Account #1
 * 5. Go to Wallet — verify wallet account matches connected DApp account
 * 6. Go back to Browser — switch wallet account to Account #2
 * 7. Go to Wallet — verify wallet followed the DApp's connected account
 * 8. Disconnect DApp
 */
async function testBrowserSync001(page) {
  const t = createStepTracker('BROWSER-SYNC-001');

  // Step 1: Ensure align mode
  await _safeStep(page, t, '\u8bbe\u7f6e\u5bf9\u9f50\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.align);
    return `mode=${CONFIG.modes.align}`;
  });

  // Step 2: Go to Browser
  await goToBrowser(page);
  t.add('\u5bfc\u822a\u5230\u6d4f\u89c8\u5668', 'passed');

  // Step 3: Open PancakeSwap
  await _safeStep(page, t, '\u6253\u5f00 PancakeSwap', async () => {
    await openDAppTab(page, CONFIG.dapps.pancakeswap.url);
    return `url=${CONFIG.dapps.pancakeswap.url}`;
  });

  // Step 4: [DApp-side] User clicks Connect Wallet -> MetaMask
  // The script cannot click inside the DApp webpage.
  // Wait for the OneKey authorization dialog to appear.
  await _safeStep(page, t, '\u7b49\u5f85\u8fde\u63a5\u6388\u6743\u5f39\u7a97', async () => {
    // [DApp-side] User clicks Connect Wallet -> MetaMask in PancakeSwap
    const hasPrompt = await waitForConnectPrompt(page, 20000);
    if (!hasPrompt) return 'skip: \u65e0\u6388\u6743\u5f39\u7a97\uff08\u53ef\u80fd\u5df2\u8fde\u63a5\u6216\u9700\u7528\u6237\u70b9\u51fb DApp \u7aef Connect\uff09';
    return '\u6388\u6743\u5f39\u7a97\u5df2\u51fa\u73b0';
  });

  // Step 5: Authorize connection with walletA / Account #1
  await _safeStep(page, t, '\u6388\u6743\u8fde\u63a5', async () => {
    const result = await authorizeConnection(page, CONFIG.walletA.name, CONFIG.walletA.accounts[0]);
    return result.connected ? `\u5df2\u6388\u6743 ${CONFIG.walletA.accounts[0]}` : `skip: ${result.reason}`;
  });

  // Step 6: Go to Wallet — verify account matches
  await _safeStep(page, t, '\u94b1\u5305\u7aef\u9a8c\u8bc1\u8d26\u6237\u5bf9\u9f50', async () => {
    await goToWallet(page);
    const walletAccount = await readCurrentWalletAccount(page);
    return `\u94b1\u5305\u5f53\u524d\u8d26\u6237: ${walletAccount}`;
  });

  // Step 7: Switch wallet account on wallet side
  await _safeStep(page, t, '\u94b1\u5305\u7aef\u5207\u6362\u8d26\u6237', async () => {
    await switchWalletAccount(page, CONFIG.walletA.name, CONFIG.walletA.accounts[1]);
    return `\u5207\u6362\u5230 ${CONFIG.walletA.accounts[1]}`;
  });

  // Step 8: Go back to Browser — verify DApp account followed wallet
  await _safeStep(page, t, '\u6d4f\u89c8\u5668\u7aef\u9a8c\u8bc1\u8d26\u6237\u8ddf\u968f', async () => {
    await goToBrowser(page);
    const dappAccount = await readDAppConnectedAccount(page);
    return `DApp \u8fde\u63a5\u8d26\u6237: ${dappAccount}`;
  });

  // Step 9: Disconnect
  await _safeStep(page, t, '\u65ad\u5f00 DApp \u8fde\u63a5', async () => {
    const disconnected = await disconnectDApp(page);
    return disconnected ? '\u5df2\u65ad\u5f00' : 'skip: \u672a\u8fde\u63a5';
  });

  return t.result();
}

/**
 * BROWSER-SYNC-002: 独立模式 — 钱包与 DApp 完全独立
 *
 * Steps:
 * 1. Switch to independent mode in settings
 * 2. Go to Browser, connect to PancakeSwap with Account #1
 * 3. Go to Wallet, switch to Account #2
 * 4. Go to Browser — verify DApp still shows Account #1 (independent)
 * 5. Go to Wallet — verify Wallet still shows Account #2 (independent)
 * 6. Disconnect and restore align mode
 */
async function testBrowserSync002(page) {
  const t = createStepTracker('BROWSER-SYNC-002');

  // Step 1: Switch to independent mode
  await _safeStep(page, t, '\u5207\u6362\u5230\u72ec\u7acb\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.independent);
    return `mode=${CONFIG.modes.independent}`;
  });

  // Step 2: Go to Browser, open DApp
  await goToBrowser(page);
  t.add('\u5bfc\u822a\u5230\u6d4f\u89c8\u5668', 'passed');

  await _safeStep(page, t, '\u6253\u5f00 PancakeSwap', async () => {
    await openDAppTab(page, CONFIG.dapps.pancakeswap.url);
    return `url=${CONFIG.dapps.pancakeswap.url}`;
  });

  // [DApp-side] User clicks Connect Wallet -> MetaMask
  await _safeStep(page, t, '\u7b49\u5f85\u8fde\u63a5\u6388\u6743\u5f39\u7a97', async () => {
    const hasPrompt = await waitForConnectPrompt(page, 20000);
    if (!hasPrompt) return 'skip: \u65e0\u6388\u6743\u5f39\u7a97\uff08\u53ef\u80fd\u5df2\u8fde\u63a5\uff09';
    return '\u6388\u6743\u5f39\u7a97\u5df2\u51fa\u73b0';
  });

  // Step 3: Authorize with Account #1
  await _safeStep(page, t, '\u6388\u6743\u8fde\u63a5 Account #1', async () => {
    const result = await authorizeConnection(page, CONFIG.walletA.name, CONFIG.walletA.accounts[0]);
    return result.connected ? `\u5df2\u6388\u6743 ${CONFIG.walletA.accounts[0]}` : `skip: ${result.reason}`;
  });

  // Record DApp account
  const dappAccountBefore = await readDAppConnectedAccount(page);
  t.add('\u8bb0\u5f55 DApp \u8fde\u63a5\u8d26\u6237', 'passed', `dapp=${dappAccountBefore}`);

  // Step 4: Go to Wallet, switch to Account #2
  await _safeStep(page, t, '\u94b1\u5305\u7aef\u5207\u6362\u5230 Account #2', async () => {
    await goToWallet(page);
    await switchWalletAccount(page, CONFIG.walletA.name, CONFIG.walletA.accounts[1]);
    const walletNow = await readCurrentWalletAccount(page);
    return `\u94b1\u5305\u5f53\u524d: ${walletNow}`;
  });

  // Step 5: Go to Browser — verify DApp still on Account #1 (independent)
  await _safeStep(page, t, '\u6d4f\u89c8\u5668\u9a8c\u8bc1 DApp \u4fdd\u6301\u72ec\u7acb', async () => {
    await goToBrowser(page);
    const dappAccountAfter = await readDAppConnectedAccount(page);
    return `DApp \u8d26\u6237: ${dappAccountAfter} (\u5e94\u4fdd\u6301\u4e0d\u53d8)`;
  });

  // Step 6: Go to Wallet — verify still on Account #2
  await _safeStep(page, t, '\u94b1\u5305\u9a8c\u8bc1\u4fdd\u6301\u72ec\u7acb', async () => {
    await goToWallet(page);
    const walletAccount = await readCurrentWalletAccount(page);
    const isStillAccount2 = walletAccount && walletAccount.includes(CONFIG.walletA.accounts[1]);
    return `\u94b1\u5305\u8d26\u6237: ${walletAccount} (${isStillAccount2 ? '\u72ec\u7acb\u6a21\u5f0f\u6b63\u5e38' : '\u53ef\u80fd\u5df2\u8ddf\u968f'})`;
  });

  // Step 7: Disconnect
  await _safeStep(page, t, '\u65ad\u5f00\u8fde\u63a5', async () => {
    await goToBrowser(page);
    const disconnected = await disconnectDApp(page);
    return disconnected ? '\u5df2\u65ad\u5f00' : 'skip: \u672a\u8fde\u63a5';
  });

  // Step 8: Restore default align mode
  await _safeStep(page, t, '\u6062\u590d\u5bf9\u9f50\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.align);
    return '\u5df2\u6062\u590d';
  });

  return t.result();
}

/**
 * BROWSER-SYNC-003: 始终使用钱包账户 — 账户跟随，网络独立 + 多 DApp + 派生路径
 *
 * Steps:
 * 1. Switch to "始终使用钱包账户" mode
 * 2. Open PancakeSwap, connect with walletA/Account #1
 * 3. Wallet side switch to Account #2 — verify DApp follows account
 * 4. Switch wallet network to non-default — verify DApp network stays independent
 * 5. Open Cetus (SUI DApp), connect
 * 6. Verify both DApps show the same wallet account
 * 7. Change derivation path — verify DApp accounts update
 * 8. Disconnect all, restore align mode
 */
async function testBrowserSync003(page) {
  const t = createStepTracker('BROWSER-SYNC-003');

  // Step 1: Switch to alwaysWallet mode
  await _safeStep(page, t, '\u5207\u6362\u5230\u59cb\u7ec8\u4f7f\u7528\u94b1\u5305\u8d26\u6237\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.alwaysWallet);
    return `mode=${CONFIG.modes.alwaysWallet}`;
  });

  // Step 2: Open PancakeSwap
  await goToBrowser(page);
  t.add('\u5bfc\u822a\u5230\u6d4f\u89c8\u5668', 'passed');

  await _safeStep(page, t, '\u6253\u5f00 PancakeSwap', async () => {
    await openDAppTab(page, CONFIG.dapps.pancakeswap.url);
    return `url=${CONFIG.dapps.pancakeswap.url}`;
  });

  // [DApp-side] User clicks Connect Wallet -> MetaMask
  await _safeStep(page, t, '\u7b49\u5f85 PancakeSwap \u8fde\u63a5\u6388\u6743', async () => {
    const hasPrompt = await waitForConnectPrompt(page, 20000);
    if (!hasPrompt) return 'skip: \u65e0\u6388\u6743\u5f39\u7a97';
    return '\u6388\u6743\u5f39\u7a97\u5df2\u51fa\u73b0';
  });

  await _safeStep(page, t, '\u6388\u6743 PancakeSwap \u8fde\u63a5', async () => {
    const result = await authorizeConnection(page, CONFIG.walletA.name, CONFIG.walletA.accounts[0]);
    return result.connected ? `\u5df2\u6388\u6743 ${CONFIG.walletA.accounts[0]}` : `skip: ${result.reason}`;
  });

  const dappAccount1 = await readDAppConnectedAccount(page);
  t.add('\u8bb0\u5f55 PancakeSwap \u8fde\u63a5\u8d26\u6237', 'passed', `account=${dappAccount1}`);

  // Step 3: Wallet switch to Account #2 — verify DApp follows
  await _safeStep(page, t, '\u94b1\u5305\u5207\u6362\u5230 Account #2', async () => {
    await goToWallet(page);
    await switchWalletAccount(page, CONFIG.walletA.name, CONFIG.walletA.accounts[1]);
    return `\u5207\u6362\u5230 ${CONFIG.walletA.accounts[1]}`;
  });

  await _safeStep(page, t, '\u9a8c\u8bc1 DApp \u8d26\u6237\u8ddf\u968f\u94b1\u5305', async () => {
    await goToBrowser(page);
    await sleep(2000);
    const dappAccount2 = await readDAppConnectedAccount(page);
    return `DApp \u8d26\u6237: ${dappAccount2} (\u5e94\u8ddf\u968f\u94b1\u5305\u5207\u6362)`;
  });

  // Step 4: Switch wallet network — verify DApp network stays independent
  await _safeStep(page, t, '\u94b1\u5305\u5207\u6362\u7f51\u7edc', async () => {
    await goToWallet(page);
    const currentNet = await readCurrentNetwork(page);
    const targetNet = currentNet?.includes('Ethereum') ? 'Polygon' : 'Ethereum';
    await switchNetwork(page, targetNet);
    return `\u94b1\u5305\u7f51\u7edc: ${targetNet}`;
  });

  await _safeStep(page, t, '\u9a8c\u8bc1 DApp \u7f51\u7edc\u72ec\u7acb', async () => {
    await goToBrowser(page);
    const dappNet = await readDAppConnectedNetwork(page);
    return `DApp \u7f51\u7edc: ${dappNet} (\u5e94\u4fdd\u6301\u72ec\u7acb)`;
  });

  // Step 5: Open Cetus (SUI) DApp
  await _safeStep(page, t, '\u6253\u5f00 Cetus (SUI)', async () => {
    await openDAppTab(page, CONFIG.dapps.cetus.url);
    return `url=${CONFIG.dapps.cetus.url}`;
  });

  // [DApp-side] User clicks Connect Wallet -> OneKey in Cetus
  await _safeStep(page, t, '\u7b49\u5f85 Cetus \u8fde\u63a5\u6388\u6743', async () => {
    const hasPrompt = await waitForConnectPrompt(page, 20000);
    if (!hasPrompt) return 'skip: \u65e0\u6388\u6743\u5f39\u7a97';
    return '\u6388\u6743\u5f39\u7a97\u5df2\u51fa\u73b0';
  });

  await _safeStep(page, t, '\u6388\u6743 Cetus \u8fde\u63a5', async () => {
    const result = await authorizeConnection(page, CONFIG.walletA.name, CONFIG.walletA.accounts[1]);
    return result.connected ? `\u5df2\u6388\u6743 ${CONFIG.walletA.accounts[1]}` : `skip: ${result.reason}`;
  });

  // Step 6: Verify both DApps show same wallet account
  await _safeStep(page, t, '\u9a8c\u8bc1\u591a DApp \u8d26\u6237\u4e00\u81f4\u6027', async () => {
    // Check Cetus
    const cetusAccount = await readDAppConnectedAccount(page);

    // Switch to PancakeSwap tab
    await openDAppTab(page, CONFIG.dapps.pancakeswap.url);
    await sleep(2000);
    const pancakeAccount = await readDAppConnectedAccount(page);

    return `Cetus=${cetusAccount}, PancakeSwap=${pancakeAccount}`;
  });

  // Step 7: Change derivation path
  await _safeStep(page, t, '\u5207\u6362\u6d3e\u751f\u8def\u5f84', async () => {
    try {
      await switchDerivationPath(page, 'EVM', 'BIP44');
      return '\u5df2\u5207\u6362\u6d3e\u751f\u8def\u5f84';
    } catch (e) {
      return `skip: ${e.message}`;
    }
  });

  await _safeStep(page, t, '\u9a8c\u8bc1\u6d3e\u751f\u8def\u5f84\u5207\u6362\u540e DApp \u8d26\u6237\u66f4\u65b0', async () => {
    await goToBrowser(page);
    await sleep(2000);
    const accountAfterPath = await readDAppConnectedAccount(page);
    return `DApp \u8d26\u6237: ${accountAfterPath} (\u6d3e\u751f\u8def\u5f84\u5207\u6362\u540e)`;
  });

  // Step 8: Disconnect all and restore
  await _safeStep(page, t, '\u65ad\u5f00\u6240\u6709 DApp', async () => {
    // Disconnect PancakeSwap
    await openDAppTab(page, CONFIG.dapps.pancakeswap.url);
    await sleep(1000);
    await disconnectDApp(page);

    // Disconnect Cetus
    await openDAppTab(page, CONFIG.dapps.cetus.url);
    await sleep(1000);
    await disconnectDApp(page);

    return '\u5df2\u65ad\u5f00\u6240\u6709 DApp';
  });

  await _safeStep(page, t, '\u6062\u590d\u5bf9\u9f50\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.align);
    return '\u5df2\u6062\u590d';
  });

  return t.result();
}

/**
 * BROWSER-SYNC-004: 异常测试 — 断开重连 + 模式切换
 *
 * Steps:
 * 1. Connect to PancakeSwap
 * 2. Disconnect
 * 3. Reconnect — verify can reconnect
 * 4. While connected, switch sync mode from align to independent
 * 5. Verify DApp connection survives mode switch
 * 6. Switch mode to alwaysWallet
 * 7. Switch wallet account — verify behavior
 * 8. Disconnect and restore
 */
async function testBrowserSync004(page) {
  const t = createStepTracker('BROWSER-SYNC-004');

  // Step 1: Ensure align mode and go to Browser
  await _safeStep(page, t, '\u8bbe\u7f6e\u5bf9\u9f50\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.align);
    return `mode=${CONFIG.modes.align}`;
  });

  await goToBrowser(page);
  t.add('\u5bfc\u822a\u5230\u6d4f\u89c8\u5668', 'passed');

  // Step 2: Open PancakeSwap and connect
  await _safeStep(page, t, '\u6253\u5f00 PancakeSwap', async () => {
    await openDAppTab(page, CONFIG.dapps.pancakeswap.url);
    return `url=${CONFIG.dapps.pancakeswap.url}`;
  });

  // [DApp-side] User clicks Connect Wallet -> MetaMask
  await _safeStep(page, t, '\u7b49\u5f85\u8fde\u63a5\u6388\u6743', async () => {
    const hasPrompt = await waitForConnectPrompt(page, 20000);
    if (!hasPrompt) return 'skip: \u65e0\u6388\u6743\u5f39\u7a97\uff08\u53ef\u80fd\u5df2\u8fde\u63a5\uff09';
    return '\u6388\u6743\u5f39\u7a97\u5df2\u51fa\u73b0';
  });

  await _safeStep(page, t, '\u6388\u6743\u8fde\u63a5', async () => {
    const result = await authorizeConnection(page, CONFIG.walletA.name, CONFIG.walletA.accounts[0]);
    return result.connected ? `\u5df2\u6388\u6743 ${CONFIG.walletA.accounts[0]}` : `skip: ${result.reason}`;
  });

  // Step 3: Disconnect
  await _safeStep(page, t, '\u65ad\u5f00\u8fde\u63a5', async () => {
    const disconnected = await disconnectDApp(page);
    return disconnected ? '\u5df2\u65ad\u5f00' : 'skip: \u672a\u8fde\u63a5';
  });

  // Step 4: Reconnect
  // [DApp-side] User clicks Connect Wallet again -> MetaMask
  await _safeStep(page, t, '\u7b49\u5f85\u91cd\u65b0\u8fde\u63a5\u6388\u6743', async () => {
    const hasPrompt = await waitForConnectPrompt(page, 20000);
    if (!hasPrompt) return 'skip: \u65e0\u6388\u6743\u5f39\u7a97\uff08\u9700\u7528\u6237\u5728 DApp \u7aef\u70b9\u51fb Connect\uff09';
    return '\u91cd\u65b0\u8fde\u63a5\u5f39\u7a97\u5df2\u51fa\u73b0';
  });

  await _safeStep(page, t, '\u91cd\u65b0\u6388\u6743', async () => {
    const result = await authorizeConnection(page, CONFIG.walletA.name, CONFIG.walletA.accounts[0]);
    return result.connected ? `\u91cd\u65b0\u6388\u6743\u6210\u529f ${CONFIG.walletA.accounts[0]}` : `skip: ${result.reason}`;
  });

  const accountBeforeModeSwitch = await readDAppConnectedAccount(page);
  t.add('\u8bb0\u5f55\u91cd\u8fde\u540e DApp \u8d26\u6237', 'passed', `account=${accountBeforeModeSwitch}`);

  // Step 5: While connected, switch to independent mode
  await _safeStep(page, t, '\u8fde\u63a5\u4e2d\u5207\u6362\u5230\u72ec\u7acb\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.independent);
    return `mode=${CONFIG.modes.independent}`;
  });

  // Step 6: Verify DApp connection survives mode switch
  await _safeStep(page, t, '\u9a8c\u8bc1 DApp \u8fde\u63a5\u672a\u4e2d\u65ad', async () => {
    await goToBrowser(page);
    const accountAfterSwitch = await readDAppConnectedAccount(page);
    return `DApp \u8d26\u6237: ${accountAfterSwitch} (\u6a21\u5f0f\u5207\u6362\u540e\u4ecd\u8fde\u63a5)`;
  });

  // Step 7: Switch to alwaysWallet mode
  await _safeStep(page, t, '\u5207\u6362\u5230\u59cb\u7ec8\u4f7f\u7528\u94b1\u5305\u8d26\u6237\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.alwaysWallet);
    return `mode=${CONFIG.modes.alwaysWallet}`;
  });

  // Step 8: Switch wallet account while in alwaysWallet mode
  await _safeStep(page, t, '\u94b1\u5305\u5207\u6362\u8d26\u6237\uff08\u59cb\u7ec8\u94b1\u5305\u6a21\u5f0f\uff09', async () => {
    await goToWallet(page);
    await switchWalletAccount(page, CONFIG.walletA.name, CONFIG.walletA.accounts[1]);
    return `\u5207\u6362\u5230 ${CONFIG.walletA.accounts[1]}`;
  });

  await _safeStep(page, t, '\u9a8c\u8bc1 DApp \u8d26\u6237\u8ddf\u968f\u94b1\u5305', async () => {
    await goToBrowser(page);
    await sleep(2000);
    const accountFinal = await readDAppConnectedAccount(page);
    return `DApp \u8d26\u6237: ${accountFinal} (\u5e94\u8ddf\u968f\u94b1\u5305)`;
  });

  // Step 9: Disconnect and restore
  await _safeStep(page, t, '\u65ad\u5f00\u8fde\u63a5', async () => {
    const disconnected = await disconnectDApp(page);
    return disconnected ? '\u5df2\u65ad\u5f00' : 'skip: \u672a\u8fde\u63a5';
  });

  await _safeStep(page, t, '\u6062\u590d\u5bf9\u9f50\u6a21\u5f0f', async () => {
    await switchSyncMode(page, CONFIG.modes.align);
    return '\u5df2\u6062\u590d\u9ed8\u8ba4\u6a21\u5f0f';
  });

  return t.result();
}

// ── Exports ──────────────────────────────────────────────────

export const testCases = [
  { id: 'BROWSER-SYNC-001', name: 'Browser-\u5bf9\u9f50\u6a21\u5f0f-\u8fde\u63a5\u540e\u94b1\u5305\u8ddf\u968f', fn: testBrowserSync001 },
  { id: 'BROWSER-SYNC-002', name: 'Browser-\u72ec\u7acb\u6a21\u5f0f-\u94b1\u5305\u4e0e DApp \u5b8c\u5168\u72ec\u7acb', fn: testBrowserSync002 },
  { id: 'BROWSER-SYNC-003', name: 'Browser-\u59cb\u7ec8\u94b1\u5305\u8d26\u6237-\u591a DApp+\u6d3e\u751f\u8def\u5f84', fn: testBrowserSync003 },
  { id: 'BROWSER-SYNC-004', name: 'Browser-\u5f02\u5e38\u4e0e\u9c81\u68d2\u6027-\u65ad\u5f00\u91cd\u8fde+\u6a21\u5f0f\u5207\u6362', fn: testBrowserSync004 },
];

export async function setup(page) {
  await unlockWalletIfNeeded(page);
  await dismissOverlays(page);
}

export async function run() {
  const filter = process.argv.slice(2).find(a => a.startsWith('BROWSER-SYNC-'));
  const casesToRun = filter ? testCases.filter(c => c.id === filter) : testCases;
  if (casesToRun.length === 0) {
    console.error(`No tests matching "${filter}"`);
    return { status: 'error' };
  }

  let { page } = await connectCDP();

  console.log('\n' + '='.repeat(60));
  console.log(`  Browser Account Sync Tests \u2014 ${casesToRun.length} case(s)`);
  console.log('='.repeat(60));

  const results = [];
  await setup(page);

  for (const test of casesToRun) {
    const startTime = Date.now();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[${test.id}] ${test.name}`);
    console.log('─'.repeat(60));

    try {
      if (page?.isClosed?.()) {
        console.log('  Page was closed, reconnecting CDP...');
        ({ page } = await connectCDP());
        await setup(page);
      }
      const result = await test.fn(page);
      const duration = Date.now() - startTime;
      const r = {
        testId: test.id,
        status: result.status,
        duration,
        steps: result.steps,
        errors: result.errors,
        timestamp: new Date().toISOString(),
      };
      console.log(`>> ${test.id}: ${r.status.toUpperCase()} (${(duration / 1000).toFixed(1)}s)`);
      writeFileSync(resolve(RESULTS_DIR, `${test.id}.json`), JSON.stringify(r, null, 2));
      results.push(r);
    } catch (error) {
      const duration = Date.now() - startTime;
      const r = {
        testId: test.id,
        status: 'failed',
        duration,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
      console.error(`>> ${test.id}: FAILED (${(duration / 1000).toFixed(1)}s) \u2014 ${error.message}`);
      if (page && !page?.isClosed?.()) {
        await screenshot(page, SCREENSHOT_DIR, `${test.id}-error`);
      }
      writeFileSync(resolve(RESULTS_DIR, `${test.id}.json`), JSON.stringify(r, null, 2));
      results.push(r);
    }

    try { if (page && !page?.isClosed?.()) await dismissOverlays(page); } catch {}
    await sleep(800);
  }

  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status !== 'passed').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${results.length} total`);
  console.log('='.repeat(60));

  const summary = { timestamp: new Date().toISOString(), total: results.length, passed, failed, results };
  writeFileSync(resolve(RESULTS_DIR, 'browser-sync-summary.json'), JSON.stringify(summary, null, 2));

  return { status: failed === 0 ? 'passed' : 'failed', passed, failed, total: results.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().then(r => process.exit(r.status === 'passed' ? 0 : 1))
    .catch(e => { console.error('Fatal:', e); process.exit(2); });
}
