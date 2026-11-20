// 2026-11-19 — Does the page's MCP client (site/mcp.js) actually work against
// the REAL roadtrip-memory server code (FastMCP 1.x + the ADR-0006 lock/CORS)?
// The unit tests use a fake server; this closes that gap.
//
// Usage: start the server locally (no DATABASE_URL needed — the handshake and
// tools/list never touch the database), then:
//   node scripts/ephemeral/2026-11-19-mcp-client-vs-real-server.mjs http://127.0.0.1:8811/mcp localtest
import { createMcpClient, toolResultText } from '../../site/mcp.js';

const [base, key] = process.argv.slice(2);
const ok = createMcpClient({ url: `${base}?key=${key}` });
const tools = await ok.listTools();
console.log('tools with right key:', tools.map((t) => t.name).join(', '));
console.log('save_favorite schema required:', JSON.stringify(tools.find((t) => t.name === 'save_favorite')?.inputSchema?.required));
const r = await ok.callTool('list_favorites', {});
console.log('list_favorites (no DB → expected setup error):', toolResultText(r).slice(0, 80));

const bad = createMcpClient({ url: `${base}?key=wrong` });
try {
  await bad.listTools();
  console.log('WRONG KEY WAS ACCEPTED — BUG');
} catch (e) {
  console.log('wrong key →', e.status, e.message);
}

// Outcome (2026-11-19, run by Tether against roadtrip-memory f401889 on :8811, MEMORY_KEY=localtest):
//   tools with right key: save_favorite, list_favorites (required: place, reason)
//   wrong key → 401 with the plain-language key message; no key → 401
//   preflight from https://tigerking-1314.github.io → 200, allow-origin echoed, mcp-* headers allowed
//   → the page's client and the real server agree; ADR-0004 build verified short of a real browser.
// Gotcha: list_favorites answered "No favorites yet" — the shell's DATABASE_URL (set in ~/.zshrc,
//   a Neon host) was inherited by the local server. Read-only, nothing written. Unset it
//   (`env -u DATABASE_URL …`) when running the server locally if you don't want that.
