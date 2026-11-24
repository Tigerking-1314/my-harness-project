// 2026-11-24 — ADR-0007 iteration 4 check: the city photo as the chat background.
// Drives headless Chrome over the DevTools protocol (same approach as
// 2026-11-24-cdp-welcome-card-screenshots.mjs), on a TRUE phone viewport (390×844, mobile)
// and on desktop, in light and dark:
//   - fakes a position (downtown Monterey — a test spot, not Tiger's) and grants geolocation,
//   - seeds a sample conversation (markdown, code, a long reply) so bubble readability over
//     the photo is checked, not just the empty state,
//   - taps 📷 (one real Wikipedia request for "Monterey, California"), then the header circle
//     (the large view), then a new empty chat, then the "Photo background" switch off,
//   - reports console errors (incl. CSP) and whether storage mentions the city/coordinates.
//
// Usage: (serve site/ first: python3 -m http.server 8765 --directory site)
//   node scripts/ephemeral/2026-11-24-cdp-photo-background-check.mjs <outdir>
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: … <outdir>');
const PAGE = 'http://localhost:8765/';
const SPOT = { latitude: 36.6002, longitude: -121.8947, accuracy: 50 };
const PORT = 9334;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const now = Date.now();
const SAMPLE = {
  id: 'demo-bigsur', title: 'Big Sur day', createdAt: now, updatedAt: now, model: 'openrouter/auto',
  systemPrompt: '', temperature: null, maxTokens: null, roadtrip: true,
  messages: [
    { role: 'user', content: 'We have one free afternoon near Monterey. Coast drive or aquarium?' },
    { role: 'assistant', model: 'openrouter/auto', content: [
      'Go for the **coast drive** — the light on Highway 1 after 3 pm is the best part of the day.',
      '',
      '1. Leave Monterey by 2:30 pm',
      '2. Stop at Bixby Bridge (pull-out on the north side)',
      '3. Turn around at Nepenthe for the view and a late lunch',
      '',
      'Fuel check before you go: `gas in Carmel` is the last cheap stop.',
    ].join('\n') },
    { role: 'user', content: 'Perfect. Save Nepenthe for us?' },
  ],
};

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
  for (const d of ['Page', 'Runtime', 'Log']) await page.send(`${d}.enable`);
  await page.send('Emulation.setGeolocationOverride', SPOT);

  const run = async (expr) => (await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async (name) => {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  };

  await page.send('Page.navigate', { url: PAGE });
  await sleep(1500);
  await run(`(() => {
    const P = 'harness:v1:';
    localStorage.setItem(P + 'settings', JSON.stringify({ model: 'openrouter/auto', showCity: true }));
    localStorage.setItem(P + 'key', 'sk-or-placeholder-for-screenshots');
    const conv = ${JSON.stringify(SAMPLE)};
    localStorage.setItem(P + 'conv:' + conv.id, JSON.stringify(conv));
    localStorage.setItem(P + 'index', JSON.stringify([{ id: conv.id, title: conv.title, updatedAt: conv.updatedAt, model: conv.model }]));
  })()`);

  const modes = [
    ['phone-light', false, { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }],
    ['phone-dark', true, { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }],
    ['desktop-light', false, { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }],
    ['desktop-dark', true, { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }],
  ];
  for (const [name, dark, metrics] of modes) {
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    await page.send('Emulation.setDeviceMetricsOverride', metrics);
    await run(`localStorage.setItem('harness:v1:settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('harness:v1:settings')), photoBackground: true }))`);
    await page.send('Page.reload');
    await sleep(2500);
    await run(`document.getElementById('here-photo-btn').click()`);
    await sleep(3000);
    console.log(name, '| city:', await run(`document.getElementById('here-city').textContent`),
      '| bg shown:', await run(`!document.getElementById('chat-bg').hidden`),
      '| switch default on:', await run(`document.getElementById('photo-bg').checked`));
    await shot(`${name}-1-chat`);
    await run(`document.getElementById('here-thumb-btn').click()`);
    await sleep(800);
    console.log(name, '| large view open:', await run(`document.getElementById('photo-view').open`),
      '| place:', await run(`document.getElementById('photo-view-place').textContent`),
      '| credit:', await run(`(a => a.hidden ? '(none)' : a.href.slice(0, 50))(document.getElementById('photo-view-credit'))`));
    await shot(`${name}-2-large`);
    await run(`document.getElementById('photo-view-close').click()`);
    if (name.startsWith('phone')) {
      await run(`document.getElementById('new-chat').click()`);
      await sleep(600);
      await shot(`${name}-3-empty`);
      await run(`(() => { const s = document.getElementById('photo-bg'); s.checked = false; s.dispatchEvent(new Event('change')); })()`);
      await sleep(600);
      console.log(name, '| after switch off, bg shown:', await run(`!document.getElementById('chat-bg').hidden`),
        '| saved:', await run(`JSON.parse(localStorage.getItem('harness:v1:settings')).photoBackground`));
      await shot(`${name}-4-switch-off`);
    }
  }
  console.log('storage mentioning the city or coordinates:', await run(`JSON.stringify(Object.keys(localStorage)
    .filter((k) => k !== 'harness:v1:conv:demo-bigsur' && /Monterey|36\\.6|121\\.8/.test(localStorage.getItem(k))))`));
  const problems = page.events.filter((e) => (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  console.log('console errors:', problems.length);
  for (const p of problems) console.log(' -', p.params.entry ? `${p.params.entry.text} ${p.params.entry.url || ''}` : JSON.stringify(p.params.args));
  page.close();
  browser.close();
} finally {
  chrome.kill();
}

// Outcome (2026-11-24, used twice):
// - All four modes: city found, background shown, switch on by default; the large view opens with
//   "Monterey, CA" + Wikipedia credit link; switching "Photo background" off hides it and saves false.
// - Bubbles, the model chip and the empty-state card stay readable over the photo in light and dark.
// - Caught on run 1 and fixed: dark-mode inline `code` vanished inside the new solid reply bubble
//   (--code-bg ≈ --bubble), and on phones the moon sat behind "Assistant" in the title.
// - Storage: nothing besides the seeded sample conversation mentions the city or coordinates.
// - Only console error: /favicon.ico 404 (the site has no icon), now confirmed by URL.
