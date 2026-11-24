// 2026-11-24 — ADR-0007 check: drive headless Chrome over the DevTools protocol to
// see the welcome card the way a real visit would, which a plain `--screenshot` can't:
//   - grant geolocation and fake a position (Monterey, CA — a test spot, not Tiger's),
//   - turn on "Show my city" in a scratch profile's localStorage,
//   - capture light / dark / phone (390px, true mobile metrics), before and after the 📷 tap,
//   - collect console errors, including CSP violations.
// The 📷 step makes one real request to Wikipedia for "Monterey, California".
//
// Usage: (serve site/ first: python3 -m http.server 8765 --directory site)
//   node scripts/ephemeral/2026-11-24-cdp-welcome-card-screenshots.mjs <outdir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: … <outdir>');
const PAGE = 'http://localhost:8765/';
const SPOT = { latitude: 36.6002, longitude: -121.8947, accuracy: 50 }; // downtown Monterey
const PORT = 9333;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(OUT, 'profile-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); })
    .then((msg) => { if (msg.error) throw new Error(`${method}: ${msg.error.message}`); return msg.result; });
  return { send, events, close: () => ws.close() };
}

try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(200); }
  }
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.send('Browser.grantPermissions', { origin: new URL(PAGE).origin, permissions: ['geolocation'] });
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page');
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Emulation.setGeolocationOverride', SPOT);

  await page.send('Page.navigate', { url: PAGE });
  await sleep(1500);
  await page.send('Runtime.evaluate', { expression: `
    const k = 'harness:v1:settings';
    localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), showCity: true }));
    localStorage.setItem('harness:v1:key', 'sk-or-placeholder-for-screenshots');` });

  const shot = async (name) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };
  const text = async (expr) => (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;

  for (const [name, dark, mobile] of [['light', false, false], ['dark', true, false], ['phone', false, true]]) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await page.send('Emulation.setDeviceMetricsOverride', mobile
      ? { width: 390, height: 780, deviceScaleFactor: 2, mobile: true }
      : { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.reload');
    await sleep(2500);
    console.log(name, '| city:', await text(`document.getElementById('here-city').textContent`),
      '| time:', await text(`document.getElementById('here-time').textContent`),
      '| 📷 visible:', await text(`!document.getElementById('here-photo-btn').hidden`));
    await shot(`${name}-before`);
    await text(`document.getElementById('here-photo-btn').click()`);
    await sleep(3000);
    console.log(name, '| thumb:', await text(`document.getElementById('here-thumb').hidden ? '(none)' : document.getElementById('here-thumb').src.slice(0, 60)`));
    await shot(`${name}-after`);
  }
  // ADR-0007 fixed rule: the city and coordinates are never stored.
  console.log('storage mentioning the city or coordinates:', await text(`JSON.stringify(Object.keys(localStorage)
    .filter((k) => /Monterey|36\\.6|121\\.8/.test(localStorage.getItem(k))))`));
  const problems = page.events.filter((e) => (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  console.log('console errors:', problems.length);
  for (const p of problems) console.log(' -', p.params.entry ? p.params.entry.text : JSON.stringify(p.params.args));
  page.close();
  browser.close();
} finally {
  chrome.kill();
}

// Outcome (2026-11-24, used 4 times):
// - "Monterey, CA" + device time in light, dark and true-390px phone; 📷 loaded the Wikipedia
//   thumbnail from thumb.wikimedia.org under the new CSP (no CSP violations).
// - Caught: sun/moon sat behind the city text (moved toward mid-sky); on the phone the
//   "📷 Photo" label truncated the city to "Monterey,…" (label hidden under 760px).
// - Storage scan after all runs: nothing mentions the city or the coordinates.
// - One console 404 remains: /favicon.ico (the site has none). Not ADR-0007's doing.
