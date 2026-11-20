// Tests for site/store.js — the browser is the ONLY copy of every conversation
// (ADR-0003), so a storage bug is data loss.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULT_SETTINGS, StorageFullError, EXPORT_FORMAT } from '../site/store.js';

/** In-memory Storage with an optional byte quota, behaving like localStorage when full. */
function memoryStorage({ quota = Infinity } = {}) {
  const map = new Map();
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const before = map.get(k);
      map.set(k, String(v));
      if (used() > quota) {
        if (before == null) map.delete(k);
        else map.set(k, before);
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
    },
    removeItem: (k) => map.delete(k),
  };
}

const conv = (id, updatedAt, messages = [{ role: 'user', content: `hello from ${id}` }]) => ({
  id, title: `chat ${id}`, createdAt: updatedAt, updatedAt, model: 'openrouter/auto', messages,
});

describe('conversations', () => {
  test('a saved conversation reloads intact, and the list is newest-first', async () => {
    const s = createStore(memoryStorage());
    await s.saveConversation(conv('old', 1));
    await s.saveConversation(conv('new', 2));
    assert.deepEqual((await s.listConversations()).map((c) => c.id), ['new', 'old']);
    assert.deepEqual(await s.loadConversation('old'), conv('old', 1));
  });

  test('re-saving a conversation updates it in place (no duplicate list entries)', async () => {
    const s = createStore(memoryStorage());
    const c = conv('a', 1);
    await s.saveConversation(c);
    c.messages.push({ role: 'assistant', content: 'hi' });
    c.updatedAt = 5;
    await s.saveConversation(c);
    const list = await s.listConversations();
    assert.equal(list.length, 1);
    assert.equal(list[0].updatedAt, 5);
    assert.equal((await s.loadConversation('a')).messages.length, 2);
  });

  test('deleting removes both the conversation and its list entry', async () => {
    const storage = memoryStorage();
    const s = createStore(storage);
    await s.saveConversation(conv('a', 1));
    await s.deleteConversation('a');
    assert.deepEqual(await s.listConversations(), []);
    assert.equal(await s.loadConversation('a'), null);
  });

  test('a corrupted entry does not crash loading', async () => {
    const storage = memoryStorage();
    storage.setItem('harness:v1:index', '{not json');
    storage.setItem('harness:v1:conv:x', '{also not json');
    const s = createStore(storage);
    assert.deepEqual(await s.listConversations(), []);
    assert.equal(await s.loadConversation('x'), null);
  });
});

describe('storage full', () => {
  test('a save that does not fit throws StorageFullError and leaves the previous state intact', async () => {
    const storage = memoryStorage({ quota: 600 });
    const s = createStore(storage);
    await s.saveConversation(conv('a', 1));
    const snapshot = new Map(storage.map);
    const huge = conv('b', 2, [{ role: 'user', content: 'x'.repeat(2000) }]);
    await assert.rejects(s.saveConversation(huge), StorageFullError);
    assert.deepEqual(storage.map, snapshot);
  });

  test('if the conversation fits but the index update does not, the conversation write is rolled back', async () => {
    // Without rollback the conversation would be stored but invisible in the list — orphaned bytes eating quota.
    const storage = memoryStorage();
    const s = createStore(storage);
    await s.saveConversation(conv('a', 1));
    const realSet = storage.setItem;
    storage.setItem = (k, v) => {
      if (k === 'harness:v1:index') {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
      return realSet.call(storage, k, v);
    };
    await assert.rejects(s.saveConversation(conv('b', 2)), StorageFullError);
    assert.equal(storage.getItem('harness:v1:conv:b'), null);
  });
});

describe('settings and key', () => {
  test('settings fall back to defaults and merge saved values', async () => {
    const s = createStore(memoryStorage());
    assert.deepEqual(await s.getSettings(), DEFAULT_SETTINGS);
    await s.saveSettings({ ...DEFAULT_SETTINGS, temperature: 0.3 });
    assert.equal((await s.getSettings()).temperature, 0.3);
  });

  test('forgetting the key removes it from storage entirely', async () => {
    const storage = memoryStorage();
    const s = createStore(storage);
    await s.setKey('sk-or-secret');
    assert.equal(await s.getKey(), 'sk-or-secret');
    await s.forgetKey();
    assert.equal(await s.getKey(), null);
    assert.equal([...storage.map.values()].some((v) => v.includes('sk-or-secret')), false);
  });
});

describe('export / import', () => {
  test('an export never contains the API key (ADR-0002)', async () => {
    const s = createStore(memoryStorage());
    await s.setKey('sk-or-v1-supersecret');
    await s.saveConversation(conv('a', 1));
    const data = await s.exportAll();
    assert.equal(data.format, EXPORT_FORMAT);
    assert.equal(data.conversations.length, 1);
    assert.equal(JSON.stringify(data).includes('supersecret'), false);
  });

  test('an export never contains the memory address and its ?key= (ADR-0004)', async () => {
    const s = createStore(memoryStorage());
    await s.setMemoryUrl('https://your-first-memory-00di.onrender.com/mcp?key=memsecret123');
    await s.saveConversation(conv('a', 1));
    assert.equal(JSON.stringify(await s.exportAll()).includes('memsecret123'), false);
  });

  test('a road-trip chat with saves in it survives export → import', async () => {
    const trip = conv('trip', 3, [
      { role: 'user', content: 'I loved Zion, save it' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'save_favorite', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'save_favorite', content: 'Saved as favorite #4', display: 'Saved: Zion' },
    ]);
    const a = createStore(memoryStorage());
    await a.saveConversation(trip);
    const b = createStore(memoryStorage());
    assert.deepEqual(await b.importAll(JSON.parse(JSON.stringify(await a.exportAll()))), { added: 1, updated: 0, skipped: 0 });
    assert.deepEqual(await b.loadConversation('trip'), trip);
  });

  test('export from one browser, import into another: conversations arrive intact', async () => {
    const laptop = createStore(memoryStorage());
    await laptop.saveConversation(conv('a', 1));
    await laptop.saveConversation(conv('b', 2));
    const phone = createStore(memoryStorage());
    const exported = JSON.parse(JSON.stringify(await laptop.exportAll())); // as if via a file
    assert.deepEqual(await phone.importAll(exported), { added: 2, updated: 0, skipped: 0 });
    assert.deepEqual(await phone.loadConversation('a'), conv('a', 1));
  });

  test('re-importing an older backup does not overwrite newer local work', async () => {
    const s = createStore(memoryStorage());
    await s.saveConversation(conv('a', 1));
    const backup = await s.exportAll();
    const newer = conv('a', 9, [{ role: 'user', content: 'newer local message' }]);
    await s.saveConversation(newer);
    assert.deepEqual(await s.importAll(backup), { added: 0, updated: 0, skipped: 1 });
    assert.deepEqual(await s.loadConversation('a'), newer);
  });

  test('a file that is not an export is rejected; malformed conversations are skipped', async () => {
    const s = createStore(memoryStorage());
    await assert.rejects(s.importAll({ hello: 'world' }), /Not a Chat Harness export/);
    const r = await s.importAll({
      format: EXPORT_FORMAT, version: 1,
      conversations: [conv('ok', 1), { id: '../etc', messages: [] }, { id: 'bad-role', messages: [{ role: 'system', content: 'x' }] }],
    });
    assert.deepEqual(r, { added: 1, updated: 0, skipped: 2 });
  });
});
