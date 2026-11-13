// UI wiring for the chat harness. Logic worth testing lives in the imported
// modules (tests/); this file is DOM glue. Decisions: docs/adr/0001–0003.

import { createStore, DEFAULT_SETTINGS, StorageFullError } from './store.js';
import {
  streamChat, buildChatBody, fetchModels,
  randomVerifier, challengeFor, buildAuthUrl, exchangeCode,
} from './openrouter.js';
import { renderMarkdown } from './markdown.js';

const APP_TITLE = 'Chat Harness';
const PKCE_KEY = 'harness:v1:pkce'; // sessionStorage: survives the OpenRouter redirect, dies with the tab
const NEW_TITLE = 'New chat';

const $ = (id) => document.getElementById(id);
const el = {
  app: $('app'), convList: $('conv-list'), newChat: $('new-chat'),
  exportBtn: $('export-btn'), importFile: $('import-file'),
  toggleSidebar: $('toggle-sidebar'), model: $('model'), modelList: $('model-list'),
  toggleSettings: $('toggle-settings'), keyBadge: $('key-badge'), settings: $('settings'),
  keyState: $('key-state'), connect: $('connect'), forgetKey: $('forget-key'),
  pasteForm: $('paste-form'), pasteKey: $('paste-key'),
  systemPrompt: $('system-prompt'), temperature: $('temperature'), maxTokens: $('max-tokens'),
  messages: $('messages'), notice: $('notice'),
  composer: $('composer'), input: $('input'), send: $('send'), stop: $('stop'),
};

const store = createStore(window.localStorage);
let settings = { ...DEFAULT_SETTINGS };
let conversations = [];
let current = null;
let streaming = null; // AbortController while a reply streams

const appUrl = () => location.origin + location.pathname;

// ---------- small helpers ----------

function notice(msg, kind = 'info') {
  el.notice.textContent = msg || '';
  el.notice.className = `notice ${kind}`;
  el.notice.hidden = !msg;
}

function numberOrNull(value, { integer = false } = {}) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.round(n) : n;
}

function newConversation() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: NEW_TITLE,
    createdAt: now,
    updatedAt: now,
    model: settings.model,
    systemPrompt: settings.systemPrompt,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    messages: [],
  };
}

async function persist(conv) {
  try {
    await store.saveConversation(conv);
    conversations = await store.listConversations();
    renderList();
    return true;
  } catch (e) {
    notice(e instanceof StorageFullError ? e.message : `Could not save: ${e.message}`, 'error');
    return false;
  }
}

// ---------- rendering ----------

function renderList() {
  const items = conversations.map((c) => {
    const item = document.createElement('div');
    item.className = 'conv' + (current && c.id === current.id ? ' active' : '');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'conv-open';
    open.textContent = c.title;
    open.title = c.title;
    open.addEventListener('click', () => openConversation(c.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'conv-del icon';
    del.textContent = '×';
    del.setAttribute('aria-label', `Delete "${c.title}"`);
    del.addEventListener('click', () => deleteConversation(c.id));
    item.append(open, del);
    return item;
  });
  el.convList.replaceChildren(...items);
}

function metaLine(m) {
  const parts = [];
  if (m.model) parts.push(m.model);
  const u = m.usage;
  if (u && u.prompt_tokens != null) parts.push(`${u.prompt_tokens} in · ${u.completion_tokens ?? 0} out tokens`);
  if (u && typeof u.cost === 'number') parts.push(`$${u.cost.toFixed(6)}`);
  if (m.stopped) parts.push('stopped');
  return parts.join(' · ');
}

function renderMessage(m) {
  const wrap = document.createElement('article');
  wrap.className = `msg ${m.role}`;
  const body = document.createElement('div');
  body.className = 'body';
  // renderMarkdown escapes every input character before adding its own tags
  // (security contract in markdown.js, tested in tests/markdown.test.js).
  if (m.role === 'assistant') body.innerHTML = renderMarkdown(m.content);
  else body.textContent = m.content;
  wrap.append(body);
  if (m.role === 'assistant') {
    const meta = metaLine(m);
    if (meta) {
      const div = document.createElement('div');
      div.className = 'meta';
      div.textContent = meta;
      wrap.append(div);
    }
  }
  if (m.error) {
    const err = document.createElement('div');
    err.className = 'msg-error';
    err.textContent = m.error;
    wrap.append(err);
  }
  return wrap;
}

function renderMessages() {
  if (!current.messages.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Start a conversation. Pick any OpenRouter model above.';
    el.messages.replaceChildren(empty);
  } else {
    el.messages.replaceChildren(...current.messages.map(renderMessage));
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderParams() {
  el.model.value = current.model || '';
  el.systemPrompt.value = current.systemPrompt || '';
  el.temperature.value = current.temperature ?? '';
  el.maxTokens.value = current.maxTokens ?? '';
}

async function renderKeyStatus() {
  const key = await store.getKey();
  el.keyBadge.textContent = key ? `key …${key.slice(-4)}` : 'no key';
  el.keyBadge.className = `badge ${key ? 'ok' : 'warn'}`;
  el.keyState.textContent = key
    ? `A key ending in …${key.slice(-4)} is saved in this browser.`
    : 'No key saved. Connect your OpenRouter account (recommended), or paste a key.';
  el.forgetKey.hidden = !key;
}

function setBusy(busy) {
  el.send.hidden = busy;
  el.stop.hidden = !busy;
}

function toggleSettings(force) {
  const open = force ?? el.settings.hidden;
  el.settings.hidden = !open;
  el.toggleSettings.setAttribute('aria-expanded', String(open));
}

// ---------- conversations ----------

function busyGuard() {
  if (streaming) {
    notice('A reply is still streaming — press Stop first.', 'info');
    return true;
  }
  return false;
}

async function openConversation(id) {
  if (busyGuard()) return;
  const conv = await store.loadConversation(id);
  if (!conv) {
    notice('That conversation could not be loaded (it may be corrupted).', 'error');
    return;
  }
  current = conv;
  notice('');
  el.app.classList.remove('sidebar-open');
  renderParams();
  renderMessages();
  renderList();
}

function startNewConversation() {
  if (busyGuard()) return;
  current = newConversation(); // saved on first message
  notice('');
  el.app.classList.remove('sidebar-open');
  renderParams();
  renderMessages();
  renderList();
  el.input.focus();
}

async function deleteConversation(id) {
  if (busyGuard()) return;
  const c = conversations.find((x) => x.id === id);
  if (!confirm(`Delete "${c ? c.title : 'this conversation'}"? This cannot be undone (unless you exported it).`)) return;
  await store.deleteConversation(id);
  conversations = await store.listConversations();
  if (current && current.id === id) startNewConversation();
  else renderList();
}

// ---------- chatting ----------

async function send(text) {
  const key = await store.getKey();
  if (!key) {
    toggleSettings(true);
    notice('Connect OpenRouter (or paste a key) first.', 'error');
    return;
  }
  notice('');
  const conv = current;
  conv.messages.push({ role: 'user', content: text });
  if (conv.title === NEW_TITLE) conv.title = text.replace(/\s+/g, ' ').trim().slice(0, 48) || NEW_TITLE;
  const history = conv.messages
    .filter((m) => m.content.trim() !== '')
    .map(({ role, content }) => ({ role, content }));
  const reply = { role: 'assistant', content: '', model: conv.model };
  conv.messages.push(reply);
  conv.updatedAt = Date.now();
  await persist(conv);
  renderMessages();

  let node = el.messages.lastElementChild;
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    const fresh = renderMessage(reply);
    node.replaceWith(fresh);
    node = fresh;
    el.messages.scrollTop = el.messages.scrollHeight;
  };
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(paint);
    }
  };

  const ctrl = new AbortController();
  streaming = ctrl;
  setBusy(true);
  try {
    const body = buildChatBody({
      model: conv.model || DEFAULT_SETTINGS.model,
      messages: history,
      systemPrompt: conv.systemPrompt,
      temperature: conv.temperature,
      maxTokens: conv.maxTokens,
    });
    for await (const ev of streamChat({ key, body, signal: ctrl.signal, appUrl: appUrl(), appTitle: APP_TITLE })) {
      if (ev.type === 'delta') reply.content += ev.content;
      else if (ev.type === 'usage') {
        reply.usage = ev.usage;
        if (ev.model) reply.model = ev.model;
      } else if (ev.type === 'error') reply.error = ev.message;
      schedule();
    }
  } catch (e) {
    if (e.name === 'AbortError') reply.stopped = true;
    else reply.error = e.message || String(e);
    if (e.status === 401) renderKeyStatus();
  } finally {
    streaming = null;
    setBusy(false);
    conv.updatedAt = Date.now();
    await persist(conv);
    if (current === conv) paint();
  }
}

// ---------- OpenRouter connect (OAuth PKCE, ADR-0002) ----------

async function startConnect() {
  const verifier = randomVerifier();
  const state = randomVerifier().slice(0, 22);
  const challenge = await challengeFor(verifier);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state }));
  location.assign(buildAuthUrl({ callbackUrl: appUrl(), challenge, state }));
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (!code) return;
  const returnedState = params.get('state');
  history.replaceState(null, '', location.pathname + location.hash); // never leave the code in the address bar
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
  } catch {
    pending = null;
  }
  sessionStorage.removeItem(PKCE_KEY);
  if (!pending) {
    notice('Got a login code, but no login was started in this tab. Click "Connect OpenRouter" again.', 'error');
    return;
  }
  if (returnedState && returnedState !== pending.state) {
    notice('The login response did not match this tab’s request, so it was ignored. Try connecting again.', 'error');
    return;
  }
  try {
    await store.setKey(await exchangeCode({ code, verifier: pending.verifier }));
    notice('Connected to OpenRouter. Your key is saved in this browser only.', 'ok');
  } catch (e) {
    notice(`Connecting failed: ${e.message}`, 'error');
  }
}

// ---------- settings bindings ----------

async function updateParam(field, value) {
  current[field] = value;
  settings = { ...settings, [field]: value }; // new chats inherit the last-used values
  try {
    await store.saveSettings(settings);
  } catch (e) {
    notice(e.message, 'error');
  }
  if (current.messages.length) await persist(current);
}

el.model.addEventListener('change', () => updateParam('model', el.model.value.trim() || DEFAULT_SETTINGS.model).then(renderParams));
el.systemPrompt.addEventListener('change', () => updateParam('systemPrompt', el.systemPrompt.value));
el.temperature.addEventListener('change', () => updateParam('temperature', numberOrNull(el.temperature.value)));
el.maxTokens.addEventListener('change', () => updateParam('maxTokens', numberOrNull(el.maxTokens.value, { integer: true })));

el.connect.addEventListener('click', () => startConnect().catch((e) => notice(`Could not start login: ${e.message}`, 'error')));
el.forgetKey.addEventListener('click', async () => {
  await store.forgetKey();
  await renderKeyStatus();
  notice('Key removed from this browser.', 'ok');
});
el.pasteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = el.pasteKey.value.trim();
  if (!key) return;
  await store.setKey(key);
  el.pasteKey.value = '';
  await renderKeyStatus();
  notice(key.startsWith('sk-or-') ? 'Key saved in this browser.' : 'Key saved — note it doesn’t look like an OpenRouter key (they start with "sk-or-").', key.startsWith('sk-or-') ? 'ok' : 'info');
});

el.toggleSettings.addEventListener('click', () => toggleSettings());
el.toggleSidebar.addEventListener('click', () => el.app.classList.toggle('sidebar-open'));
el.newChat.addEventListener('click', startNewConversation);

// ---------- composer ----------

el.composer.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = el.input.value;
  if (!text.trim() || streaming) return;
  el.input.value = '';
  send(text);
});
el.input.addEventListener('keydown', (e) => {
  // isComposing: Enter that confirms an IME candidate (e.g. Chinese/Japanese input) must not send
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el.composer.requestSubmit();
  }
});
el.stop.addEventListener('click', () => streaming && streaming.abort());

// ---------- export / import ----------

el.exportBtn.addEventListener('click', async () => {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chat-harness-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  notice(`Exported ${data.conversations.length} conversation(s). The file never contains your API key.`, 'ok');
});
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files[0];
  el.importFile.value = '';
  if (!file) return;
  try {
    const r = await store.importAll(JSON.parse(await file.text()));
    conversations = await store.listConversations();
    renderList();
    notice(`Imported: ${r.added} new, ${r.updated} updated, ${r.skipped} skipped.`, 'ok');
  } catch (e) {
    notice(`Import failed: ${e.message}`, 'error');
  }
});

// ---------- boot ----------

async function init() {
  await handleOAuthCallback();
  settings = await store.getSettings();
  conversations = await store.listConversations();
  current = (conversations[0] && (await store.loadConversation(conversations[0].id))) || newConversation();
  renderParams();
  renderMessages();
  renderList();
  await renderKeyStatus();
  if (!(await store.getKey())) toggleSettings(true);
  fetchModels()
    .then((models) => {
      el.modelList.replaceChildren(...models.map((m) => {
        const o = document.createElement('option');
        o.value = m.id;
        o.label = m.name;
        return o;
      }));
    })
    .catch(() => { /* model list is a convenience; any id can still be typed */ });
}

init();
