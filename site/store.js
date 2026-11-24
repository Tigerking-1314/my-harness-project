// Browser persistence (ADR-0003): localStorage behind an async-shaped API, so
// a later move to IndexedDB changes this file only. `storage` is injected
// (window.localStorage in the app, an in-memory fake in tests).
//
// Keys are namespaced `harness:v1:` because every GitHub Pages site on the
// account shares this origin's storage (ADR-0002 QST-ORIGIN).

export const PREFIX = 'harness:v1:';
export const EXPORT_FORMAT = 'chat-harness-export';
const K = {
  settings: `${PREFIX}settings`,
  index: `${PREFIX}index`,
  key: `${PREFIX}key`,
  memory: `${PREFIX}memory`, // road-trip memory URL — carries its ?key= secret (ADR-0004)
  conv: (id) => `${PREFIX}conv:${id}`,
};
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const DEFAULT_SETTINGS = Object.freeze({
  model: 'openrouter/auto',
  systemPrompt: '',
  temperature: null, // null = provider default
  maxTokens: null,
  roadtrip: false, // road-trip assistant mode (ADR-0004)
  showCity: false, // read location on open for the header city (ADR-0007); the city itself is never stored
});

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full — export your conversations, then delete some old ones.');
    this.name = 'StorageFullError';
  }
}

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

function summary(conv) {
  return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, model: conv.model };
}

function validMessage(m) {
  if (!m || typeof m.content !== 'string') return false;
  if (m.role === 'user') return true;
  if (m.role === 'assistant') return m.tool_calls === undefined || Array.isArray(m.tool_calls);
  if (m.role === 'tool') return typeof m.tool_call_id === 'string'; // road-trip memory results (ADR-0004)
  return false;
}

function validConversation(c) {
  return (
    c && typeof c === 'object' &&
    typeof c.id === 'string' && ID_RE.test(c.id) &&
    Array.isArray(c.messages) &&
    c.messages.every(validMessage)
  );
}

export function createStore(storage) {
  const readJSON = (k, fallback) => {
    const raw = storage.getItem(k);
    if (raw == null) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback; // a corrupted entry must not take the whole app down
    }
  };
  const write = (k, value) => {
    try {
      storage.setItem(k, typeof value === 'string' ? value : JSON.stringify(value));
    } catch (e) {
      if (isQuotaError(e)) throw new StorageFullError();
      throw e;
    }
  };
  const readIndex = () => {
    const idx = readJSON(K.index, []);
    return Array.isArray(idx) ? idx : [];
  };

  async function getSettings() {
    return { ...DEFAULT_SETTINGS, ...readJSON(K.settings, {}) };
  }
  async function saveSettings(s) {
    write(K.settings, s);
  }
  async function listConversations() {
    return readIndex().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function loadConversation(id) {
    return readJSON(K.conv(id), null);
  }
  /** Writes the conversation, then the index; if the index write fails, the conversation write is undone. */
  async function saveConversation(conv) {
    const key = K.conv(conv.id);
    const previous = storage.getItem(key);
    write(key, conv);
    try {
      write(K.index, [...readIndex().filter((e) => e.id !== conv.id), summary(conv)]);
    } catch (e) {
      try {
        if (previous == null) storage.removeItem(key);
        else storage.setItem(key, previous);
      } catch {
        /* best effort */
      }
      throw e;
    }
  }
  async function deleteConversation(id) {
    storage.removeItem(K.conv(id));
    write(K.index, readIndex().filter((e) => e.id !== id));
  }

  async function getKey() {
    return storage.getItem(K.key);
  }
  async function setKey(key) {
    write(K.key, key);
  }
  async function forgetKey() {
    storage.removeItem(K.key);
  }

  // The memory URL holds a secret too, so it gets the key's treatment:
  // this browser only, never exported.
  async function getMemoryUrl() {
    return storage.getItem(K.memory);
  }
  async function setMemoryUrl(url) {
    write(K.memory, url);
  }
  async function forgetMemoryUrl() {
    storage.removeItem(K.memory);
  }

  /** Everything worth backing up — never the API key (ADR-0002) nor the memory URL (ADR-0004). */
  async function exportAll() {
    const conversations = readIndex()
      .map((e) => readJSON(K.conv(e.id), null))
      .filter(validConversation);
    return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), conversations };
  }

  /** Merge an export back in; on an id clash the newer `updatedAt` wins. */
  async function importAll(data) {
    if (!data || data.format !== EXPORT_FORMAT || data.version !== 1 || !Array.isArray(data.conversations)) {
      throw new Error('Not a Chat Harness export file.');
    }
    const result = { added: 0, updated: 0, skipped: 0 };
    for (const c of data.conversations) {
      if (!validConversation(c)) {
        result.skipped++;
        continue;
      }
      const conv = {
        ...c,
        title: typeof c.title === 'string' && c.title ? c.title : 'Imported chat',
        updatedAt: Number(c.updatedAt) || 0,
      };
      const existing = await loadConversation(conv.id);
      if (!existing) {
        await saveConversation(conv);
        result.added++;
      } else if (conv.updatedAt > (existing.updatedAt || 0)) {
        await saveConversation(conv);
        result.updated++;
      } else {
        result.skipped++;
      }
    }
    return result;
  }

  return {
    getSettings, saveSettings,
    listConversations, loadConversation, saveConversation, deleteConversation,
    getKey, setKey, forgetKey,
    getMemoryUrl, setMemoryUrl, forgetMemoryUrl,
    exportAll, importAll,
  };
}
