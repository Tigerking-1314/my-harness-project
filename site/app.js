// UI wiring for the chat harness. Logic worth testing lives in the imported
// modules (tests/); this file is DOM glue. Decisions: docs/adr/0001–0007.

import { createStore, DEFAULT_SETTINGS, StorageFullError } from './store.js';
import {
  streamChat, buildChatBody, fetchModels,
  randomVerifier, challengeFor, buildAuthUrl, exchangeCode,
} from './openrouter.js';
import { renderMarkdown } from './markdown.js';
import { createMcpClient, toolResultText } from './mcp.js';
import {
  ROADTRIP_PROMPT, MAX_TOOL_ROUNDS, needsConfirmation, toOpenAITools,
  accumulateToolCall, finalizeToolCalls, parseArgs, historyForApi,
} from './tools.js';
import { parseCities, nearestCity, describePlace, cityLabel } from './geo.js';
import { fetchWikiPhoto } from './photo.js';

const APP_TITLE = "Tiger's Road-Trip Assistant"; // ADR-0006; also the X-Title OpenRouter shows
const PKCE_KEY = 'harness:v1:pkce'; // sessionStorage: survives the OpenRouter redirect, dies with the tab
const NEW_TITLE = 'New chat';
// Must match the CSP connect-src in index.html (ADR-0004).
const MEMORY_ORIGINS = ['https://your-first-memory-00di.onrender.com'];

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
  memoryState: $('memory-state'), memoryForm: $('memory-form'), memoryUrl: $('memory-url'),
  forgetMemory: $('forget-memory'), roadtrip: $('roadtrip'), roadtripBadge: $('roadtrip-badge'),
  showCity: $('show-city'), hereCity: $('here-city'), hereTime: $('here-time'),
  hereThumb: $('here-thumb'), herePhotoBtn: $('here-photo-btn'),
};

const store = createStore(window.localStorage);
let settings = { ...DEFAULT_SETTINGS };
let conversations = [];
let current = null;
let streaming = null; // AbortController while a reply streams
let memory = null; // { url, client, tools } — the road-trip memory connection
// ADR-0007: where you are, for the header. In memory only, never stored or exported:
// { status: 'locating'|'error'|'found', text, title, city, label, photo, noPhoto }
let here = null;
const modelInfo = new Map(); // id → { name, tools } from OpenRouter's model list

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
    roadtrip: !!settings.roadtrip,
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
  if (m.role === 'tool') {
    const note = document.createElement('div');
    note.className = 'tool-note';
    note.textContent = m.display || m.content;
    return note;
  }
  // an assistant turn that only asked for tools has nothing to show
  if (m.role === 'assistant' && !m.content && m.tool_calls?.length && !m.error) return null;
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
    // ADR-0006: the dashed-road empty state (night road in dark mode);
    // ADR-0007: the city's landmark photo takes its place when there is one.
    const empty = document.createElement('div');
    empty.className = 'empty';
    if (here && here.photo) {
      empty.append(renderPhotoFigure(here.photo));
    } else {
      const pic = document.createElement('picture');
      const night = document.createElement('source');
      night.media = '(prefers-color-scheme: dark)';
      night.srcset = 'art/road-night.svg';
      const img = document.createElement('img');
      img.src = 'art/road.svg';
      img.alt = '';
      img.width = 320;
      img.height = 200;
      pic.append(night, img);
      empty.append(pic);
    }
    const heading = document.createElement('h2');
    heading.textContent = 'Where to next?';
    const hint = document.createElement('p');
    hint.textContent = 'Ask about routes, stops, or places you loved. Pick any OpenRouter model above.';
    empty.append(heading, hint);
    el.messages.replaceChildren(empty);
  } else {
    el.messages.replaceChildren(...current.messages.map(renderMessage).filter(Boolean));
  }
  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderParams() {
  el.model.value = current.model || '';
  el.systemPrompt.value = current.systemPrompt || '';
  el.temperature.value = current.temperature ?? '';
  el.maxTokens.value = current.maxTokens ?? '';
  el.roadtrip.checked = !!current.roadtrip;
  el.roadtripBadge.hidden = !current.roadtrip;
}

async function renderMemoryStatus() {
  const url = await store.getMemoryUrl();
  el.memoryState.textContent = url
    ? `Memory address saved (server ${new URL(url).host}).`
    : 'No memory address saved. Paste your server address, including ?key=…, to use road-trip mode.';
  el.forgetMemory.hidden = !url;
}

function warnIfModelCantUseTools() {
  const info = modelInfo.get(current.model);
  if (current.roadtrip && info && info.tools === false) {
    notice(`${current.model} can't use tools, so it can't reach your road-trip memory. Pick another model (e.g. openrouter/auto).`, 'error');
  }
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

  const ctrl = new AbortController();
  streaming = ctrl;
  setBusy(true);
  try {
    let tools;
    if (conv.roadtrip) {
      try {
        tools = toOpenAITools((await connectMemory()).tools);
      } catch (e) {
        notice(`Road-trip memory unavailable — answering without it. ${e.message}`, 'error');
      }
    }
    // The tool loop (ADR-0004): the model may ask for tools; the page runs
    // them (saves only after a click) and hands results back, a few rounds max.
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const reply = { role: 'assistant', content: '', model: conv.model };
      conv.messages.push(reply);
      conv.updatedAt = Date.now();
      await persist(conv);
      if (current === conv) renderMessages();
      const calls = await streamReply(conv, reply, key, tools, ctrl.signal);
      if (!calls.length || ctrl.signal.aborted) break;
      reply.tool_calls = calls;
      await persist(conv);
      for (const call of calls) {
        const outcome = await runTool(call, ctrl.signal);
        conv.messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, ...outcome });
        await persist(conv);
        if (current === conv) renderMessages();
      }
      if (ctrl.signal.aborted) break; // Stop pressed while a Save card was open
      if (round === MAX_TOOL_ROUNDS - 1) notice('Stopped after several memory steps in a row — ask again to continue.', 'info');
    }
  } finally {
    streaming = null;
    setBusy(false);
    conv.updatedAt = Date.now();
    await persist(conv);
    if (current === conv) renderMessages();
  }
}

/** Stream one assistant reply into `reply`; returns the tool calls it asked for (maybe none). */
async function streamReply(conv, reply, key, tools, signal) {
  let node = el.messages.lastElementChild;
  let scheduled = false;
  const paint = () => {
    scheduled = false;
    if (current !== conv || !node) return;
    const fresh = renderMessage(reply) || document.createElement('div');
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
  const calls = [];
  try {
    const systemPrompt = conv.roadtrip
      ? [ROADTRIP_PROMPT, conv.systemPrompt].filter((s) => s && s.trim()).join('\n\n')
      : conv.systemPrompt;
    const body = buildChatBody({
      model: conv.model || DEFAULT_SETTINGS.model,
      messages: historyForApi(conv.messages),
      systemPrompt,
      temperature: conv.temperature,
      maxTokens: conv.maxTokens,
      tools,
    });
    for await (const ev of streamChat({ key, body, signal, appUrl: appUrl(), appTitle: APP_TITLE })) {
      if (ev.type === 'delta') reply.content += ev.content;
      else if (ev.type === 'tool_call') accumulateToolCall(calls, ev);
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
    return [];
  }
  return reply.error ? [] : finalizeToolCalls(calls);
}

// ---------- road-trip memory (ADR-0004) ----------

async function withWakeNotice(fn) {
  const WAKE = 'Waking up your memory server — free servers nap, this can take ~30 seconds…';
  const timer = setTimeout(() => notice(WAKE, 'info'), 2000);
  try {
    return await fn();
  } finally {
    clearTimeout(timer);
    if (el.notice.textContent === WAKE) notice('');
  }
}

async function connectMemory() {
  const url = await store.getMemoryUrl();
  if (!url) throw new Error('No memory address saved yet — add it under Settings → Road-trip memory.');
  if (!memory || memory.url !== url) memory = { url, client: createMcpClient({ url }), tools: null };
  if (!memory.tools) memory.tools = await withWakeNotice(() => memory.client.listTools());
  return memory;
}

/** Run one tool call; returns { content (for the model), display (for Tiger) }. */
async function runTool(call, signal) {
  const name = call.function.name;
  const args = parseArgs(call.function.arguments);
  if (!memory || !memory.tools.some((t) => t.name === name)) {
    return { content: `Error: there is no tool named ${name}.`, display: `Unknown tool requested: ${name}` };
  }
  if (args === null) {
    return { content: 'Error: the tool arguments were not valid JSON.', display: `${name}: the model sent unreadable arguments` };
  }
  if (needsConfirmation(name)) {
    const approved = await askToConfirm(name, args, signal);
    if (!approved) {
      return {
        content: 'Tiger did not approve this, so nothing was saved. Do not retry unless Tiger asks.',
        display: name === 'save_favorite' ? `Not saved: ${args.place ?? ''}` : `Not run: ${name}`,
      };
    }
  }
  try {
    const text = toolResultText(await withWakeNotice(() => memory.client.callTool(name, args)));
    const display =
      name === 'list_favorites' ? 'Checked your road-trip favorites'
      : name === 'save_favorite' ? `Saved to your favorites: ${args.place} — “${args.reason}”`
      : `${name}: ${text}`;
    return { content: text, display: text.startsWith('Error:') ? `Memory error: ${text}` : display };
  } catch (e) {
    return { content: `Error: ${e.message}`, display: `Memory error: ${e.message}` };
  }
}

/** Show a Save / Don't-save card; resolves true only on Tiger's click (QST-SAVE-OK = B). */
function askToConfirm(name, args, signal) {
  return new Promise((resolve) => {
    const card = document.createElement('div');
    card.className = 'confirm-card';
    const title = document.createElement('div');
    title.className = 'confirm-title';
    const details = document.createElement('dl');
    const add = (label, value) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      details.append(dt, dd);
    };
    if (name === 'save_favorite') {
      title.textContent = 'Save to your road-trip memory?';
      add('Place', String(args.place ?? ''));
      add('Reason', String(args.reason ?? ''));
    } else {
      title.textContent = `Allow the assistant to run “${name}” on your memory?`;
      add('Details', JSON.stringify(args));
    }
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'primary';
    yes.textContent = name === 'save_favorite' ? 'Save' : 'Allow';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = name === 'save_favorite' ? 'Don’t save' : 'Don’t allow';
    const row = document.createElement('div');
    row.className = 'row';
    row.append(yes, no);
    card.append(title, details, row);

    const finish = (answer) => {
      signal.removeEventListener('abort', onAbort);
      card.remove();
      resolve(answer);
    };
    const onAbort = () => finish(false);
    yes.addEventListener('click', () => finish(true));
    no.addEventListener('click', () => finish(false));
    signal.addEventListener('abort', onAbort);
    el.messages.append(card);
    el.messages.scrollTop = el.messages.scrollHeight;
    yes.focus();
  });
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

el.model.addEventListener('change', () =>
  updateParam('model', el.model.value.trim() || DEFAULT_SETTINGS.model).then(() => {
    renderParams();
    warnIfModelCantUseTools();
  }),
);
el.roadtrip.addEventListener('change', async () => {
  await updateParam('roadtrip', el.roadtrip.checked);
  el.roadtripBadge.hidden = !el.roadtrip.checked;
  if (el.roadtrip.checked && !(await store.getMemoryUrl())) {
    notice('Road-trip mode is on — now paste your memory address under Settings → Road-trip memory.', 'info');
  } else {
    warnIfModelCantUseTools();
  }
});
el.memoryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = el.memoryUrl.value.trim();
  if (!raw) return;
  let url;
  try {
    url = new URL(raw);
  } catch {
    notice('That doesn’t look like a web address.', 'error');
    return;
  }
  if (!MEMORY_ORIGINS.includes(url.origin)) {
    // the page's security policy (CSP) only allows these servers — see ADR-0004
    notice(`This page may only talk to ${MEMORY_ORIGINS.join(', ')} (its security policy). Use that server’s address.`, 'error');
    return;
  }
  await store.setMemoryUrl(url.toString());
  memory = null; // reconnect with the new address
  el.memoryUrl.value = '';
  await renderMemoryStatus();
  notice(
    url.searchParams.get('key') ? 'Memory address saved in this browser.' : 'Saved — but it has no ?key=…, so a locked server will refuse it.',
    url.searchParams.get('key') ? 'ok' : 'info',
  );
});
el.forgetMemory.addEventListener('click', async () => {
  await store.forgetMemoryUrl();
  memory = null;
  await renderMemoryStatus();
  notice('Memory address removed from this browser.', 'ok');
});
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

// ---------- where you are (ADR-0007) ----------
// Coordinates live only inside locate(); the nearest city is found on this device.
// Nothing here is written to storage. Wikipedia is contacted only from the 📷 button.

let citiesPromise = null;
let photosPromise = null;
let locateSeq = 0; // a newer locate() (or switching off) makes older results stale

const loadCities = () => (citiesPromise ||= import('./cities.js').then((m) => parseCities(m.CITIES)));
const loadPhotos = () => (photosPromise ||= import('./photos.js').then((m) => m.PHOTOS).catch(() => ({})));

const clockFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function tickClock() {
  el.hereTime.textContent = clockFormat.format(new Date());
}

function setHere(next) {
  here = next;
  renderHere();
  if (current && !current.messages.length) renderMessages();
}

function renderHere() {
  const show = !!(settings.showCity && here);
  el.hereCity.hidden = !show;
  el.hereCity.textContent = show ? here.text : '';
  el.hereCity.title = show ? here.title || '' : '';
  const photo = show ? here.photo : null;
  el.hereThumb.hidden = !photo;
  if (photo) {
    el.hereThumb.src = photo.src;
    el.hereThumb.alt = photo.alt;
    el.hereThumb.title = photo.caption;
  } else {
    el.hereThumb.removeAttribute('src');
  }
  const canAsk = show && here.status === 'found' && !here.photo && !here.noPhoto;
  el.herePhotoBtn.hidden = !canAsk;
  if (canAsk) el.herePhotoBtn.title = `Ask Wikipedia for a photo of ${here.label}. Wikipedia will see the city name.`;
}

function renderPhotoFigure(photo) {
  const fig = document.createElement('figure');
  fig.className = 'empty-photo';
  const img = document.createElement('img');
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.src = photo.src;
  img.alt = photo.alt;
  const cap = document.createElement('figcaption');
  cap.textContent = photo.caption;
  if (photo.credit) {
    const a = document.createElement('a');
    a.href = photo.credit;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'photo credit & licence';
    cap.append(' · ', a);
  }
  fig.append(img, cap);
  return fig;
}

async function locate() {
  if (!settings.showCity) return;
  const seq = ++locateSeq;
  const stale = () => seq !== locateSeq || !settings.showCity;
  if (!('geolocation' in navigator)) {
    setHere({ status: 'error', text: '📍 No location', title: "This browser can't share a location." });
    return;
  }
  setHere({ status: 'locating', text: 'Finding your city…' });
  let hit;
  try {
    const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve, reject, { enableHighAccuracy: false, maximumAge: 10 * 60_000, timeout: 20_000 },
    ));
    const cities = await loadCities();
    hit = nearestCity(cities, { lat: pos.coords.latitude, lon: pos.coords.longitude });
  } catch (e) {
    if (stale()) return;
    const blocked = e && e.code === 1; // GeolocationPositionError.PERMISSION_DENIED
    setHere({
      status: 'error',
      text: '📍 Location off',
      title: blocked
        ? 'Location is blocked for this site. Allow it in the browser’s site settings, or turn off “Show my city” in Settings.'
        : 'Couldn’t get your location just now.',
    });
    return;
  }
  if (stale()) return;
  if (!hit) {
    setHere({ status: 'error', text: '📍 No city found', title: '' });
    return;
  }
  const label = cityLabel(hit.city);
  const own = (await loadPhotos())[label];
  if (stale()) return;
  setHere({
    status: 'found',
    text: describePlace(hit),
    title: 'Found on this device. Your location is not sent or saved.',
    city: hit.city,
    label,
    photo: own ? { src: `photos/${own.file}`, alt: own.caption || label, caption: own.caption || label, credit: null } : null,
    noPhoto: false,
  });
}

el.showCity.addEventListener('change', async () => {
  settings = { ...settings, showCity: el.showCity.checked };
  try {
    await store.saveSettings(settings);
  } catch (e) {
    notice(e.message, 'error');
  }
  if (settings.showCity) {
    locate(); // this click is the gesture the browser's "Allow location?" prompt answers to
  } else {
    locateSeq++;
    setHere(null);
  }
});

el.herePhotoBtn.addEventListener('click', async () => {
  const asked = here;
  if (!asked || asked.status !== 'found') return;
  el.herePhotoBtn.disabled = true;
  try {
    const p = await fetchWikiPhoto(asked.city);
    if (here !== asked) return;
    if (!p) {
      setHere({ ...asked, noPhoto: true });
      notice(`Wikipedia has no photo for ${asked.label}.`, 'info');
      return;
    }
    setHere({
      ...asked,
      photo: { src: p.src, alt: `Photo from the Wikipedia article ${p.article}`, caption: `From Wikipedia: ${p.article}`, credit: p.credit },
    });
  } catch (e) {
    notice(`Couldn’t reach Wikipedia: ${e.message}`, 'error');
  } finally {
    el.herePhotoBtn.disabled = false;
  }
});

// ---------- boot ----------

async function init() {
  await handleOAuthCallback();
  settings = await store.getSettings();
  el.showCity.checked = !!settings.showCity;
  tickClock();
  setInterval(tickClock, 15_000);
  locate(); // only does anything with "Show my city" on (ADR-0007 QST-LOCATE-WHEN = C)
  conversations = await store.listConversations();
  current = (conversations[0] && (await store.loadConversation(conversations[0].id))) || newConversation();
  renderParams();
  renderMessages();
  renderList();
  await renderKeyStatus();
  await renderMemoryStatus();
  if (!(await store.getKey())) toggleSettings(true);
  fetchModels()
    .then((models) => {
      for (const m of models) modelInfo.set(m.id, m);
      warnIfModelCantUseTools();
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
