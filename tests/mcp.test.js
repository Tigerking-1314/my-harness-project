// Tests for site/mcp.js — the page's line to Tiger's road-trip memory (ADR-0004).
// The fake server below answers the way the real FastMCP server does
// (SSE-framed JSON-RPC, mcp-session-id header), checked against the live
// server on 2026-11-19.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpClient, parseSseMessages, toolResultText, McpError } from '../site/mcp.js';

const URL_WITH_KEY = 'https://your-first-memory-00di.onrender.com/mcp?key=test';
const sseReply = (msg, sessionId) =>
  new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...(sessionId && { 'mcp-session-id': sessionId }) },
  });

/** A fake FastMCP server. `sessions` lists the session ids it currently knows. */
function fakeServer({ tools = [{ name: 'list_favorites', inputSchema: { type: 'object' } }], onCall } = {}) {
  const log = [];
  const sessions = new Set();
  let n = 0;
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const sid = init.headers['mcp-session-id'];
    log.push({ method: body.method, sid, protocol: init.headers['mcp-protocol-version'], url });
    if (body.method === 'initialize') {
      const id = `s${++n}`;
      sessions.add(id);
      return sseReply({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-03-26', serverInfo: { name: 'fake' } } }, id);
    }
    if (!sessions.has(sid)) return new Response('{"error":"Session not found"}', { status: 404 });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list') return sseReply({ jsonrpc: '2.0', id: body.id, result: { tools } });
    if (body.method === 'tools/call') return sseReply({ jsonrpc: '2.0', id: body.id, result: onCall(body.params) });
    return new Response('', { status: 400 });
  };
  return { fetchImpl, log, sessions };
}

describe('MCP client', () => {
  test('handshakes once, then lists tools with the session id and protocol version', async () => {
    const srv = fakeServer();
    const client = createMcpClient({ url: URL_WITH_KEY, fetchImpl: srv.fetchImpl });
    assert.deepEqual((await client.listTools()).map((t) => t.name), ['list_favorites']);
    await client.listTools();
    assert.deepEqual(srv.log.map((l) => l.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/list']);
    assert.equal(srv.log[2].sid, 's1');
    assert.equal(srv.log[2].protocol, '2025-03-26');
    assert.equal(srv.log[0].url, URL_WITH_KEY, 'the ?key= must travel with every request');
  });

  test('a tool call returns the server text', async () => {
    const srv = fakeServer({
      onCall: ({ name, arguments: a }) => ({ content: [{ type: 'text', text: `Saved ${a.place} via ${name}` }] }),
    });
    const client = createMcpClient({ url: URL_WITH_KEY, fetchImpl: srv.fetchImpl });
    const r = await client.callTool('save_favorite', { place: 'Zion', reason: 'Liked the hiking' });
    assert.equal(toolResultText(r), 'Saved Zion via save_favorite');
  });

  test('after the free server naps and restarts, the stale session is replaced and the call retried', async () => {
    const srv = fakeServer({ onCall: () => ({ content: [{ type: 'text', text: '#1 Big Sur — Beautiful coast' }] }) });
    const client = createMcpClient({ url: URL_WITH_KEY, fetchImpl: srv.fetchImpl });
    await client.listTools();
    srv.sessions.clear(); // Render restarted the process: old session ids are unknown (404)
    const r = await client.callTool('list_favorites', {});
    assert.equal(toolResultText(r), '#1 Big Sur — Beautiful coast');
    assert.deepEqual(srv.log.slice(-4).map((l) => l.method), ['tools/call', 'initialize', 'notifications/initialized', 'tools/call']);
  });

  test('a wrong key is reported as a key problem, not retried', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response('{"error":"Missing or wrong key."}', { status: 401 });
    };
    const client = createMcpClient({ url: URL_WITH_KEY, fetchImpl });
    await assert.rejects(client.listTools(), (e) => e instanceof McpError && e.status === 401 && /key/.test(e.message));
    assert.equal(calls, 1);
  });

  test('an unreachable server (asleep, blocked, or wrong address) gives a plain-language error', async () => {
    const fetchImpl = async () => {
      throw new TypeError('Failed to fetch');
    };
    const client = createMcpClient({ url: URL_WITH_KEY, fetchImpl });
    await assert.rejects(client.listTools(), /Could not reach your memory server/);
  });

  test('a failed first attempt does not poison later ones', async () => {
    let down = true;
    const srv = fakeServer();
    const fetchImpl = async (u, i) => {
      if (down) throw new TypeError('Failed to fetch');
      return srv.fetchImpl(u, i);
    };
    const client = createMcpClient({ url: URL_WITH_KEY, fetchImpl });
    await assert.rejects(client.listTools());
    down = false;
    assert.equal((await client.listTools()).length, 1);
  });
});

describe('helpers', () => {
  test('SSE bodies with several events are split into messages', () => {
    const text = 'event: message\ndata: {"id":1}\n\nevent: message\ndata: {"id":2}\n\n';
    assert.deepEqual(parseSseMessages(text), [{ id: 1 }, { id: 2 }]);
  });

  test('a tool error is marked so the model knows it failed', () => {
    assert.equal(toolResultText({ isError: true, content: [{ type: 'text', text: 'DATABASE_URL is not set.' }] }), 'Error: DATABASE_URL is not set.');
  });
});
