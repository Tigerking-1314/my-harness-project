// Tests for site/tools.js — tool-use plumbing for the road-trip assistant (ADR-0004).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  needsConfirmation, accumulateToolCall, finalizeToolCalls, parseArgs, historyForApi, toOpenAITools,
} from '../site/tools.js';

describe('the Save gate (QST-SAVE-OK = B)', () => {
  test('saving always needs a click; reading favorites does not', () => {
    assert.equal(needsConfirmation('save_favorite'), true);
    assert.equal(needsConfirmation('list_favorites'), false);
  });

  test('a tool the server adds later is gated by default', () => {
    // e.g. a future delete_favorite must never run on the model's say-so
    assert.equal(needsConfirmation('delete_favorite'), true);
  });
});

describe('streamed tool calls', () => {
  test('arguments arriving in fragments are reassembled', () => {
    const calls = [];
    accumulateToolCall(calls, { index: 0, id: 'call_a', name: 'save_favorite', arguments: '' });
    accumulateToolCall(calls, { index: 0, arguments: '{"place":"Zi' });
    accumulateToolCall(calls, { index: 0, arguments: 'on","reason":"Liked the hiking"}' });
    const [call] = finalizeToolCalls(calls);
    assert.equal(call.function.name, 'save_favorite');
    assert.deepEqual(parseArgs(call.function.arguments), { place: 'Zion', reason: 'Liked the hiking' });
  });

  test('two calls in one reply stay separate, and a provider repeating the name does not garble it', () => {
    const calls = [];
    accumulateToolCall(calls, { index: 0, id: 'c1', name: 'list_favorites', arguments: '{}' });
    accumulateToolCall(calls, { index: 1, id: 'c2', name: 'save_favorite', arguments: '{"place":"Big Sur",' });
    accumulateToolCall(calls, { index: 1, id: 'c2', name: 'save_favorite', arguments: '"reason":"Beautiful coast"}' });
    const done = finalizeToolCalls(calls);
    assert.deepEqual(done.map((c) => c.function.name), ['list_favorites', 'save_favorite']);
    assert.equal(parseArgs(done[1].function.arguments).place, 'Big Sur');
  });

  test('a call without an id still gets one, so its result can be paired', () => {
    const [call] = finalizeToolCalls(accumulateToolCall([], { index: 0, name: 'list_favorites', arguments: '{}' }));
    assert.equal(call.id, 'call_0');
  });

  test('unreadable arguments are detected instead of crashing', () => {
    assert.equal(parseArgs('{"place": "Zion"'), null);
    assert.equal(parseArgs('["Zion"]'), null);
    assert.deepEqual(parseArgs(''), {});
  });
});

describe('history sent to the model', () => {
  const ask = { role: 'user', content: 'I loved Zion, save it' };
  const callMsg = {
    role: 'assistant', content: '', model: 'm', usage: { total_tokens: 9 },
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save_favorite', arguments: '{"place":"Zion"}' } }],
  };
  const result = { role: 'tool', tool_call_id: 'c1', name: 'save_favorite', content: 'Saved as favorite #4', display: 'Saved: Zion' };

  test('a completed save keeps its call/result pair, without local-only fields', () => {
    assert.deepEqual(historyForApi([ask, callMsg, result, { role: 'assistant', content: 'Saved Zion!' }]), [
      { role: 'user', content: 'I loved Zion, save it' },
      { role: 'assistant', content: '', tool_calls: callMsg.tool_calls },
      { role: 'tool', tool_call_id: 'c1', content: 'Saved as favorite #4' },
      { role: 'assistant', content: 'Saved Zion!' },
    ]);
  });

  test('a page reloaded while the Save card was open does not break the next message', () => {
    // The stored chat ends with a tool call that never got a result. Sent as-is,
    // OpenRouter rejects the whole request; it must be dropped instead.
    const next = { role: 'user', content: 'Where should I stop in Utah?' };
    assert.deepEqual(historyForApi([ask, callMsg, next]), [
      { role: 'user', content: 'I loved Zion, save it' },
      { role: 'user', content: 'Where should I stop in Utah?' },
    ]);
  });

  test('the empty placeholder of a stopped reply is not sent', () => {
    assert.deepEqual(historyForApi([ask, { role: 'assistant', content: '', stopped: true }]), [
      { role: 'user', content: 'I loved Zion, save it' },
    ]);
  });
});

test('MCP tool descriptions become OpenRouter tool definitions', () => {
  const [t] = toOpenAITools([{
    name: 'save_favorite',
    description: 'Save a road-trip favorite',
    inputSchema: { type: 'object', properties: { place: { type: 'string' }, reason: { type: 'string' } }, required: ['place', 'reason'] },
  }]);
  assert.equal(t.type, 'function');
  assert.equal(t.function.name, 'save_favorite');
  assert.deepEqual(t.function.parameters.required, ['place', 'reason']);
});
