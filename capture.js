/**
 * capture.js — Advanced Site Crawler & Screenshot Tool
 *
 * Logs into a site, crawls every reachable page, and takes screenshots
 * at desktop, tablet, and mobile viewports.
 *
 * Usage:
 *   node capture.js                          # uses config.json in same dir
 *   node capture.js my-config.json           # uses a specific config file
 *
 * Config file format: see config.example.json
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'mobile',  width: 390,  height: 844 },
];

const DEFAULT_CONFIG = {
  startUrl:        null,          // required — the URL to begin crawling from
  outputDir:       './screenshots',
  viewports:       DEFAULT_VIEWPORTS,
  maxPages:        200,           // safety cap
  concurrency:     1,             // pages processed at once (keep at 1 for auth sites)
  waitUntil:       'networkidle2',// puppeteer navigation event
  pageTimeout:     30000,
  screenshotDelay: 800,           // ms to wait before capturing (lets animations settle)
  fullPage:        true,          // capture full scrollable height
  skipPatterns:    [],            // regex strings — matching URLs are skipped
  allowedDomains:  [],            // extra domains to follow (e.g. CDN, app subdomain)
  login: {
    enabled:       false,
    url:           null,          // login page URL (defaults to startUrl if null)
    usernameSelector: 'input[name="email"]',
    passwordSelector: 'input[name="password"]',
    submitSelector:   'button[type="submit"]',
    username:      null,
    password:      null,
    waitAfterLogin: 2000,         // ms — give the app time to redirect after login
    successIndicator: null,       // optional CSS selector that confirms login worked
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    console.error(`\n  Config file not found: ${configPath}`);
    console.error('  Copy config.example.json to config.json and fill it in.\n');
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error(`\n  Invalid JSON in config file: ${e.message}\n`);
    process.exit(1);
  }

  // Deep merge with defaults
  const cfg = {
    ...DEFAULT_CONFIG,
    ...raw,
    login: { ...DEFAULT_CONFIG.login, ...(raw.login || {}) },
    viewports: raw.viewports || DEFAULT_CONFIG.viewports,
  };

  if (!cfg.startUrl) {
    console.error('\n  "startUrl" is required in your config file.\n');
    process.exit(1);
  }

  return cfg;
}

function safeFilename(urlStr) {
  const u = new URL(urlStr);
  const host = u.hostname.replace(/^www\./, '').replace(/\./g, '-');
  const page = u.pathname
    .replace(/\/$/, '')
    .replace(/\//g, '__')
    .replace(/[^a-z0-9_\-]/gi, '-')
    .replace(/^-+|-+$/g, '') || 'home';
  const query = u.search
    ? '__q' + u.search.replace(/[^a-z0-9]/gi, '-').slice(0, 40)
    : '';
  return `${host}__${page}${query}`;
}

function isSameDomain(href, startUrl, allowedDomains) {
  try {
    const target  = new URL(href);
    const origin  = new URL(startUrl);
    const allowed = [origin.hostname, ...allowedDomains];
    return allowed.some(d => target.hostname === d || target.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function shouldSkip(href, skipPatterns) {
  if (!skipPatterns || skipPatterns.length === 0) return false;
  return skipPatterns.some(p => new RegExp(p, 'i').test(href));
}

function normalise(href, base) {
  try {
    const u = new URL(href, base);
    // Drop fragments, preserve query strings
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

const SKIP_EXTENSIONS = /\.(pdf|zip|png|jpg|jpeg|gif|svg|webp|ico|mp4|mp3|woff|woff2|ttf|eot|css|js|xml|json|csv|xlsx|docx)(\?.*)?$/i;

async function collectLinks(page, baseUrl) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href'))
      .filter(Boolean);
  }).then(hrefs =>
    hrefs
      .map(h => normalise(h, baseUrl))
      .filter(h => h && !SKIP_EXTENSIONS.test(h))
  );
}

function log(msg)   { console.log(`  ${msg}`); }
function ok(msg)    { console.log(`  ✓ ${msg}`); }
function warn(msg)  { console.log(`  ⚠ ${msg}`); }
function err(msg)   { console.log(`  ✗ ${msg}`); }
function head(msg)  { console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`); }

// ─── Login ───────────────────────────────────────────────────────────────────

async function performLogin(page, loginCfg, startUrl) {
  const loginUrl = loginCfg.url || startUrl;

  log(`Navigating to login page: ${loginUrl}`);
  await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  // Fill username
  try {
    await page.waitForSelector(loginCfg.usernameSelector, { timeout: 8000 });
    await page.type(loginCfg.usernameSelector, loginCfg.username, { delay: 40 });
    log(`Filled username field (${loginCfg.usernameSelector})`);
  } catch {
    err(`Could not find username field: ${loginCfg.usernameSelector}`);
    err('Check usernameSelector in your config and try again.');
    process.exit(1);
  }

  // Fill password
  try {
    await page.waitForSelector(loginCfg.passwordSelector, { timeout: 5000 });
    await page.type(loginCfg.passwordSelector, loginCfg.password, { delay: 40 });
    log(`Filled password field (${loginCfg.passwordSelector})`);
  } catch {
    err(`Could not find password field: ${loginCfg.passwordSelector}`);
    process.exit(1);
  }

  // Submit
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: loginCfg.waitAfterLogin + 10000 }),
      page.click(loginCfg.submitSelector),
    ]);
    log('Login form submitted, waiting for redirect...');
  } catch {
    // Some SPAs don't do a full navigation — just wait
    await new Promise(r => setTimeout(r, loginCfg.waitAfterLogin));
    warn('No full navigation after submit (SPA?). Continuing anyway.');
  }

  await new Promise(r => setTimeout(r, loginCfg.waitAfterLogin));

  // Verify login if a success indicator was provided
  if (loginCfg.successIndicator) {
    try {
      await page.waitForSelector(loginCfg.successIndicator, { timeout: 8000 });
      ok(`Login confirmed — found success indicator: ${loginCfg.successIndicator}`);
    } catch {
      warn(`Login success indicator not found (${loginCfg.successIndicator}). Proceeding anyway — check screenshots for redirect to login page.`);
    }
  } else {
    ok('Login submitted (no successIndicator configured — verify manually if needed).');
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run(configPath) {
  const cfg = loadConfig(configPath);

  head(`Site Crawler & Screenshot Tool`);
  log(`Start URL  : ${cfg.startUrl}`);
  log(`Output dir : ${cfg.outputDir}`);
  log(`Max pages  : ${cfg.maxPages}`);
  log(`Viewports  : ${cfg.viewports.map(v => v.name).join(', ')}`);
  log(`Login      : ${cfg.login.enabled ? 'enabled' : 'disabled'}`);

  fs.mkdirSync(cfg.outputDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  // Use a single persistent context so session cookies carry across pages
  const page = await browser.newPage();

  // ── Login ─────────────────────────────────────────────────────────────────
  if (cfg.login.enabled) {
    head('Step 1 — Login');
    if (!cfg.login.username || !cfg.login.password) {
      err('"login.username" and "login.password" are required when login.enabled is true.');
      await browser.close();
      process.exit(1);
    }
    await performLogin(page, cfg.login, cfg.startUrl);
  }

  // ── Crawl ─────────────────────────────────────────────────────────────────
  head('Step 2 — Crawling');

  const visited   = new Set();
  const queue     = [cfg.startUrl];
  const pageOrder = [];   // ordered list of pages to screenshot

  while (queue.length > 0 && visited.size < cfg.maxPages) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    if (shouldSkip(url, cfg.skipPatterns)) { warn(`Skipping (pattern match): ${url}`); continue; }

    visited.add(url);
    log(`[${visited.size}] Crawling: ${url}`);

    try {
      await page.goto(url, { waitUntil: cfg.waitUntil, timeout: cfg.pageTimeout });
      pageOrder.push(url);

      const links = await collectLinks(page, url);
      let newCount = 0;
      for (const link of links) {
        if (
          !visited.has(link) &&
          !queue.includes(link) &&
          isSameDomain(link, cfg.startUrl, cfg.allowedDomains) &&
          !shouldSkip(link, cfg.skipPatterns)
        ) {
          queue.push(link);
          newCount++;
        }
      }
      if (newCount) log(`  Found ${newCount} new link(s)`);
    } catch (e) {
      err(`Failed to crawl ${url}: ${e.message}`);
    }
  }

  if (visited.size >= cfg.maxPages) {
    warn(`Hit maxPages limit (${cfg.maxPages}). Increase it in config to crawl more.`);
  }

  head(`Step 3 — Screenshots (${pageOrder.length} pages × ${cfg.viewports.length} viewports)`);

  let total = 0;
  let failed = 0;

  for (let i = 0; i < pageOrder.length; i++) {
    const url       = pageOrder[i];
    const fileBase  = safeFilename(url);
    console.log(`\n  [${i + 1}/${pageOrder.length}] ${url}`);

    for (const vp of cfg.viewports) {
      const filename = `${fileBase}__${vp.name}.png`;
      const filepath = path.join(cfg.outputDir, filename);

      // Skip if already captured (useful on re-runs)
      if (fs.existsSync(filepath)) {
        warn(`  Already exists, skipping: ${filename}`);
        continue;
      }

      try {
        await page.setViewport({ width: vp.width, height: vp.height });
        await page.goto(url, { waitUntil: cfg.waitUntil, timeout: cfg.pageTimeout });
        await new Promise(r => setTimeout(r, cfg.screenshotDelay));
        await page.screenshot({ path: filepath, fullPage: cfg.fullPage });
        ok(`  ${vp.name} (${vp.width}×${vp.height}) → ${filename}`);
        total++;
      } catch (e) {
        err(`  ${vp.name} failed: ${e.message}`);
        failed++;
      }
    }
  }

  await browser.close();

  head('Done');
  log(`Pages crawled  : ${pageOrder.length}`);
  log(`Screenshots    : ${total} saved`);
  if (failed) warn(`Failures       : ${failed}`);
  log(`Output folder  : ${path.resolve(cfg.outputDir)}`);
  console.log('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const configArg = process.argv[2] || 'config.json';
run(configArg).catch(e => {
  console.error('\nFatal error:', e);
  process.exit(1);
});
