// Tests for site/openrouter.js — the code between the page and OpenRouter.
// A silent bug here loses or garbles replies, or breaks "Connect OpenRouter".
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChatBody, createSSEParser, streamChat, describeHttpError,
  challengeFor, buildAuthUrl, exchangeCode, OpenRouterError,
} from '../site/openrouter.js';

const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (content) => sse({ choices: [{ delta: { content } }] });

/** A fetch Response whose body arrives in the given string pieces (as the network would split it). */
function streamingResponse(pieces, { status = 200 } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) {
      for (const p of pieces) c.enqueue(enc.encode(p));
      c.close();
    },
  });
  return new Response(body, { status });
}

describe('buildChatBody', () => {
  test('prepends the conversation system prompt and requests streaming + usage', () => {
    const body = buildChatBody({
      model: 'anthropic/claude-sonnet-5.5',
      messages: [{ role: 'user', content: 'hi' }],
      systemPrompt: 'Answer in French.',
      temperature: 0.2,
      maxTokens: 300,
    });
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'Answer in French.' },
      { role: 'user', content: 'hi' },
    ]);
    assert.equal(body.stream, true);
    assert.deepEqual(body.usage, { include: true });
    assert.equal(body.temperature, 0.2);
    assert.equal(body.max_tokens, 300);
  });

  test('blank system prompt and unset knobs are omitted, so the provider defaults apply', () => {
    const body = buildChatBody({ model: 'm', messages: [{ role: 'user', content: 'x' }], systemPrompt: '   ', temperature: null, maxTokens: null });
    assert.deepEqual(body.messages, [{ role: 'user', content: 'x' }]);
    assert.equal('temperature' in body, false);
    assert.equal('max_tokens' in body, false);
  });

  test('temperature 0 is a real setting, not "unset"', () => {
    assert.equal(buildChatBody({ model: 'm', messages: [], temperature: 0 }).temperature, 0);
  });
});

describe('SSE parsing', () => {
  test('a chunk split mid-line across network reads is reassembled, not dropped', () => {
    const p = createSSEParser();
    const whole = delta('Hello, wor') + delta('ld!');
    const cut = whole.indexOf('wor') ; // split inside the JSON of the first event
    const events = [...p.push(whole.slice(0, cut)), ...p.push(whole.slice(cut))];
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.content).join(''), 'Hello, world!');
  });

  test('OpenRouter keep-alive comments are ignored and [DONE] ends the stream', () => {
    const p = createSSEParser();
    const events = p.push(': OPENROUTER PROCESSING\n\n' + delta('ok') + 'data: [DONE]\n\n');
    assert.deepEqual(events, [{ type: 'delta', content: 'ok' }, { type: 'done' }]);
  });

  test('handles CRLF line endings', () => {
    const p = createSSEParser();
    const events = p.push(`data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\r\n\r\n`);
    assert.deepEqual(events, [{ type: 'delta', content: 'a' }]);
  });

  test('a mid-stream provider error becomes an error event the UI can show', () => {
    const p = createSSEParser();
    const events = p.push(sse({ error: { code: 502, message: 'Provider returned error' }, choices: [] }));
    assert.deepEqual(events, [{ type: 'error', message: 'Provider returned error' }]);
  });

  test('the final usage chunk (tokens + cost) is surfaced with the actual model', () => {
    const p = createSSEParser();
    const usage = { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17, cost: 0.00042 };
    const events = p.push(sse({ model: 'openai/gpt-5', choices: [{ delta: {} }], usage }));
    assert.deepEqual(events, [{ type: 'usage', usage, model: 'openai/gpt-5' }]);
  });
});

describe('streamChat', () => {
  test('streams deltas from a response body split at arbitrary byte boundaries', async () => {
    // multi-byte UTF-8 (Chinese + emoji) split across reads must not turn into U+FFFD garbage
    const text = delta('你好') + delta(' 🌍') + 'data: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    let request;
    const fetchImpl = async (url, init) => {
      request = { url, init };
      return new Response(body);
    };
    let out = '';
    for await (const ev of streamChat({ key: 'sk-or-test', body: { model: 'm' }, appTitle: 'Chat Harness', fetchImpl })) {
      if (ev.type === 'delta') out += ev.content;
    }
    assert.equal(out, '你好 🌍');
    assert.equal(request.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(request.init.headers.Authorization, 'Bearer sk-or-test');
    assert.equal(request.init.headers['X-Title'], 'Chat Harness');
  });

  test('a rejected key surfaces as an OpenRouterError telling the user what to do', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } }), { status: 401 });
    await assert.rejects(
      async () => {
        for await (const _ of streamChat({ key: 'bad', body: {}, fetchImpl }));
      },
      (e) => e instanceof OpenRouterError && e.status === 401 && /Reconnect/.test(e.message) && /No auth credentials/.test(e.message),
    );
  });

  test('a stream that ends without [DONE] still delivers its last line', async () => {
    const fetchImpl = async () => streamingResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' } }] })}`]);
    const events = [];
    for await (const ev of streamChat({ key: 'k', body: {}, fetchImpl })) events.push(ev);
    assert.deepEqual(events, [{ type: 'delta', content: 'tail' }]);
  });
});

describe('describeHttpError', () => {
  test('out-of-credits is explained, with the server detail kept', () => {
    const msg = describeHttpError(402, JSON.stringify({ error: { message: 'Insufficient credits' } }));
    assert.match(msg, /out of credits/);
    assert.match(msg, /Insufficient credits/);
  });
  test('a non-JSON error body does not throw', () => {
    assert.equal(describeHttpError(503, '<html>Bad gateway</html>'), 'OpenRouter returned HTTP 503.');
  });
});

describe('OAuth PKCE', () => {
  test('S256 challenge matches the RFC 7636 Appendix B test vector', async () => {
    // If this is wrong, OpenRouter rejects every key exchange.
    // Expected value checked against https://www.rfc-editor.org/rfc/rfc7636.txt Appendix B
    // on 2026-11-12 — NOT from memory (see docs/vignettes/2026-11-12-when-the-red-test-is-wrong.md).
    assert.equal(
      await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('auth URL carries the callback, challenge, method and state', () => {
    const u = new URL(buildAuthUrl({ callbackUrl: 'https://tigerking-1314.github.io/my-hardness-project/', challenge: 'abc', state: 's1' }));
    assert.equal(u.origin + u.pathname, 'https://openrouter.ai/auth');
    assert.equal(u.searchParams.get('callback_url'), 'https://tigerking-1314.github.io/my-hardness-project/');
    assert.equal(u.searchParams.get('code_challenge'), 'abc');
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(u.searchParams.get('state'), 's1');
  });

  test('code exchange posts code + verifier and returns the key', async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ key: 'sk-or-v1-user' }), { status: 200 });
    };
    assert.equal(await exchangeCode({ code: 'c0de', verifier: 'v3r', fetchImpl }), 'sk-or-v1-user');
    assert.equal(sent.url, 'https://openrouter.ai/api/v1/auth/keys');
    assert.deepEqual(sent.body, { code: 'c0de', code_verifier: 'v3r', code_challenge_method: 'S256' });
  });

  test('an expired code (403) is reported, not swallowed', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'Invalid code' } }), { status: 403 });
    await assert.rejects(exchangeCode({ code: 'old', verifier: 'v', fetchImpl }), /Invalid code/);
  });
});
