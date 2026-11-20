// OpenRouter client for a backend-free page (ADR-0002).
// Pure where possible so tests/openrouter.test.js can exercise it under `node --test`:
// request building, SSE stream parsing, and the OAuth PKCE helpers.

export const API_BASE = 'https://openrouter.ai/api/v1';
export const AUTH_URL = 'https://openrouter.ai/auth';

export class OpenRouterError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
  }
}

/**
 * Build the JSON body for POST /chat/completions.
 * `messages` is the visible history ([{role, content}]); the per-conversation
 * system prompt is prepended here so it is never stored as a chat bubble.
 */
export function buildChatBody({ model, messages, systemPrompt, temperature, maxTokens, tools }) {
  const out = [];
  if (systemPrompt && systemPrompt.trim()) out.push({ role: 'system', content: systemPrompt });
  for (const m of messages) {
    const msg = { role: m.role, content: m.content };
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    out.push(msg);
  }
  const body = { model, messages: out, stream: true, usage: { include: true } };
  if (tools && tools.length) body.tools = tools;
  if (typeof temperature === 'number' && Number.isFinite(temperature)) body.temperature = temperature;
  if (Number.isInteger(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  return body;
}

/** Turn one parsed SSE JSON chunk into zero or more app events. */
export function interpretChunk(obj) {
  if (obj && obj.error) {
    return [{ type: 'error', message: obj.error.message || 'The model provider reported an error mid-stream.' }];
  }
  const events = [];
  const choice = obj?.choices?.[0];
  const delta = choice?.delta;
  if (delta?.content) events.push({ type: 'delta', content: delta.content });
  if (Array.isArray(delta?.tool_calls)) {
    // streamed in fragments: the id/name usually first, the JSON arguments in pieces (ADR-0004)
    for (const tc of delta.tool_calls) {
      events.push({ type: 'tool_call', index: tc.index ?? 0, id: tc.id, name: tc.function?.name, arguments: tc.function?.arguments });
    }
  }
  if (choice?.finish_reason) events.push({ type: 'finish', reason: choice.finish_reason });
  if (obj?.usage) events.push({ type: 'usage', usage: obj.usage, model: obj.model });
  return events;
}

/**
 * Incremental Server-Sent-Events parser. Network reads split anywhere —
 * mid-line, mid-JSON, mid-UTF-8 (the caller's TextDecoder handles bytes) —
 * so lines are buffered until their newline arrives.
 * OpenRouter sends keep-alive comments (": OPENROUTER PROCESSING"); those and
 * any non-`data:` lines are ignored. `data: [DONE]` ends the stream.
 */
export function createSSEParser() {
  let buf = '';
  return {
    push(text) {
      buf += text;
      const events = [];
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (data === '[DONE]') {
          events.push({ type: 'done' });
          continue;
        }
        let obj;
        try {
          obj = JSON.parse(data);
        } catch {
          continue; // not JSON (should not happen with OpenRouter) — skip rather than kill the reply
        }
        events.push(...interpretChunk(obj));
      }
      return events;
    },
  };
}

/** Human-readable message for a failed HTTP response. */
export function describeHttpError(status, bodyText) {
  let detail = '';
  try {
    detail = JSON.parse(bodyText)?.error?.message || '';
  } catch {
    detail = '';
  }
  const hint = {
    401: 'OpenRouter rejected the key. Reconnect or paste a new key in Settings.',
    402: 'This key is out of credits (or hit its credit limit) on OpenRouter.',
    429: 'Rate limited — wait a moment and try again.',
  }[status];
  return [hint || `OpenRouter returned HTTP ${status}.`, detail].filter(Boolean).join(' — ');
}

/**
 * Stream a chat completion. Async generator of events:
 * {type:'delta', content} | {type:'usage', usage, model} | {type:'error', message} | {type:'done'}.
 * Throws OpenRouterError on a non-2xx response; an abort surfaces as the
 * fetch AbortError.
 */
export async function* streamChat({ key, body, signal, appUrl, appTitle, fetchImpl = globalThis.fetch }) {
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (appUrl) headers['HTTP-Referer'] = appUrl;
  if (appTitle) headers['X-Title'] = appTitle;
  const res = await fetchImpl(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new OpenRouterError(describeHttpError(res.status, text), res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
        yield ev;
        if (ev.type === 'done') return;
      }
    }
    for (const ev of parser.push(decoder.decode() + '\n')) yield ev;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Public model list (no key needed). Returns [{id, name, tools}] sorted by id; `tools` = can use tools. */
export async function fetchModels(fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(`${API_BASE}/models`);
  if (!res.ok) throw new OpenRouterError(describeHttpError(res.status, await res.text().catch(() => '')), res.status);
  const json = await res.json();
  return (json.data || [])
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ---- OAuth PKCE (https://openrouter.ai/docs/use-cases/oauth-pkce) ----

export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 43-char high-entropy code_verifier (RFC 7636 §4.1). */
export function randomVerifier(cryptoImpl = globalThis.crypto) {
  return base64url(cryptoImpl.getRandomValues(new Uint8Array(32)));
}

/** S256 code_challenge = base64url(SHA-256(verifier)). */
export async function challengeFor(verifier, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildAuthUrl({ callbackUrl, challenge, state }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set('callback_url', callbackUrl);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

/** Exchange the one-time `code` (valid 10 min) for a user-owned API key. */
export async function exchangeCode({ code, verifier, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${API_BASE}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  const text = await res.text();
  if (!res.ok) throw new OpenRouterError(describeHttpError(res.status, text), res.status);
  const key = JSON.parse(text)?.key;
  if (!key) throw new OpenRouterError('OpenRouter did not return a key.', res.status);
  return key;
}
