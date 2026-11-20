// Minimal MCP client over Streamable HTTP, for the browser (ADR-0004).
// Speaks just enough of the protocol for the road-trip memory: initialize →
// notifications/initialized → tools/list, tools/call. Tested in tests/mcp.test.js.

export const PROTOCOL_VERSION = '2025-03-26';

export class McpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'McpError';
    this.status = status;
  }
}

export function describeMcpHttpError(status) {
  return (
    {
      401: 'Your memory server rejected the key — check the memory address (ending in ?key=…) in Settings.',
      503: 'Your memory server is locked but has no key set yet (MEMORY_KEY on Render).',
    }[status] || `Your memory server returned HTTP ${status}.`
  );
}

/** Parse a complete text/event-stream body into its JSON messages. */
export function parseSseMessages(text) {
  const messages = [];
  let data = [];
  const flush = () => {
    if (data.length) {
      try {
        messages.push(JSON.parse(data.join('\n')));
      } catch {
        /* not JSON — ignore */
      }
    }
    data = [];
  };
  for (const raw of String(text).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') flush();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  flush();
  return messages;
}

/** The text a tool returned, as one string for the model. */
export function toolResultText(result) {
  const text = (result?.content || [])
    .filter((c) => c && c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return (result?.isError ? 'Error: ' : '') + (text || '(no output)');
}

export function createMcpClient({ url, clientName = 'chat-harness', fetchImpl = (...a) => globalThis.fetch(...a) }) {
  let sessionId = null;
  let protocolVersion = null;
  let ready = null;
  let nextId = 1;

  async function post(message) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    if (protocolVersion) headers['mcp-protocol-version'] = protocolVersion;
    try {
      return await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(message) });
    } catch {
      throw new McpError(
        'Could not reach your memory server — it may still be waking up (free servers nap), or the address is wrong.',
        0,
      );
    }
  }

  async function rpc(method, params) {
    const id = nextId++;
    const res = await post({ jsonrpc: '2.0', id, method, params });
    if (!res.ok) throw new McpError(describeMcpHttpError(res.status), res.status);
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;
    const type = res.headers.get('content-type') || '';
    const messages = type.includes('text/event-stream') ? parseSseMessages(await res.text()) : [await res.json()];
    const msg = messages.find((m) => m && m.id === id);
    if (!msg) throw new McpError('Your memory server sent no answer.', res.status);
    if (msg.error) throw new McpError(msg.error.message || 'Your memory server reported an error.', res.status);
    return msg.result;
  }

  async function initialize() {
    sessionId = null;
    protocolVersion = null;
    const result = await rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: '1' },
    });
    protocolVersion = result.protocolVersion || PROTOCOL_VERSION;
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    if (!res.ok) throw new McpError(describeMcpHttpError(res.status), res.status);
  }

  function ensureReady() {
    if (!ready) {
      ready = initialize().catch((e) => {
        ready = null;
        throw e;
      });
    }
    return ready;
  }

  async function request(method, params) {
    await ensureReady();
    try {
      return await rpc(method, params);
    } catch (e) {
      // A free Render server that napped comes back as a new process that
      // doesn't know our old session: 404. Start a fresh session, retry once.
      if (e.status === 404) {
        ready = null;
        await ensureReady();
        return rpc(method, params);
      }
      throw e;
    }
  }

  return {
    async listTools() {
      return (await request('tools/list', {})).tools || [];
    },
    callTool(name, args) {
      return request('tools/call', { name, arguments: args });
    },
  };
}
