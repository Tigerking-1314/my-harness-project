<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# Browser-side persistence — conversations and settings

- **Date**: 2026-11-12
- **Iteration**: 2
- **Status**: Accepted
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: Store settings and conversations in localStorage as stated, behind one small storage module with versioned JSON, quota-error handling and JSON export/import — so a later move to IndexedDB is a one-file change.

---

## Originating Context

**Source**: `Human dump` — Tiger's founding message, 2026-11-12 (full text in ADR-0001). The line this ADR chunks:

> storage in local storage

**Agency Grant**: Explore options and recommend; Tiger rules.

---

## Explicitation

**What I understand**:

1. **Everything the app remembers lives in this one browser** — settings, the key (ADR-0002), and chat history. No sync across devices, no server copy.
2. **localStorage's real limits**: ~5 MB per *origin* (strings only, synchronous), and on GitHub Pages that origin is shared with every other Pages site on the account (ADR-0002 QST-ORIGIN). Text chats are small — a long conversation is tens of KB — so hundreds of conversations fit; images or file attachments would not.
3. **The data can vanish**: "clear site data", private windows, and some browsers' storage eviction policies (Safari can evict script-written storage for sites not visited in 7 days, under its tracking-prevention rules) all erase it without asking.

**Assumptions**:

- v1 is text-only (no image uploads) — revisit if QST-SCOPE in ADR-0001 adds attachments.

**Confirm**: Tiger.

---

## Questions

### QST-STORE: localStorage only, or IndexedDB for conversations?
- Status: answered
- Why asking: the dump names localStorage; I want to confirm it was a requirement and not shorthand for "in the browser". The two differ in capacity (~5 MB vs. typically hundreds of MB+), API (simple sync strings vs. async database), and what happens when the space runs out.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — localStorage only**: one key per conversation plus an index and a settings key, JSON-encoded. Simplest code; ~5 MB ceiling shared with the whole `github.io` origin.
- **B — IndexedDB for everything**: async object store; far larger capacity, stores binary (images) natively; more code, and harder to inspect by hand.
- **C — Split**: localStorage for settings and the key, IndexedDB for conversations.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — localStorage only**, behind a `store.js` module whose interface is async-shaped (`await store.load(id)`) so swapping in IndexedDB later changes one file. *Rationale*: it's what Tiger asked for, text conversations fit comfortably (Explicitation 2), and it's directly inspectable in DevTools — useful while learning. Writes catch `QuotaExceededError` and tell the user instead of silently dropping a message. *Confidence*: 0.8 — because the capacity math holds for text-only chat. *If wrong*: if ADR-0001 QST-SCOPE adds image/file attachments, or real usage approaches ~3 MB, flip to C.

**ANS:** (by Tiger Liu)
A — localStorage only, behind an async-shaped store.js module. Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

### QST-EXPORT: Ship conversation export/import (JSON download/upload) in v1?
- Status: answered
- Why asking: with no backend, the browser is the only copy of every conversation, and it can be erased without warning (Explicitation 3). Export is the only backup and the only way to move history to another device.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Yes, in v1**: "Export all" downloads one `.json` file (never containing the API key); "Import" merges a file back in. ~50 lines.
- **B — Later**: v1 ships without it; history is best-effort.
- **C — Export only**: download in v1, import when there's a second device to need it.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — Yes, in v1.** *Rationale*: it is cheap, it is the only defense against the silent-loss modes in Explicitation 3, and import doubles as a test fixture loader (load a known conversation to check rendering). *Confidence*: 0.75 — because the value depends on how much Tiger cares about keeping chats, which I don't know yet. *If wrong*: if Tiger treats chats as disposable scratch, B — and storage could even be session-only.

**ANS:** (by Tiger Liu)
A — Yes, export/import in v1 (export never contains the API key). Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

## Decision

*Accepted 2026-11-12 (all recommendations, Tiger Liu): A localStorage only · A export/import in v1. Data shape:*

```
harness:v1:settings        → { model, temperature, systemPrompt, ... }
harness:v1:index           → [ { id, title, updatedAt, model } ]
harness:v1:conv:<id>       → { id, title, createdAt, updatedAt, model, messages: [ { role, content, usage? } ] }
harness:v1:key             → per ADR-0002 QST-KEY-PERSIST
```

The `harness:v1:` prefix namespaces this app inside the shared `github.io` origin and versions the schema so a future format change can migrate instead of crash.

---

## Action Items

- [x] Answer QST-STORE, QST-EXPORT - Owner: Tiger Liu
- [ ] Write `store.js` + `node --test` tests (round-trip, quota error, schema version) - Owner: Tether

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from Tiger's founding message (chunked from ADR-0001's source)
- Contributors: Tether (Claude Opus 5.5)
- Changes: two questions minted; provisional key schema
- Outcome: Draft

### Iteration 2 (2026-11-12)
- Human: Tiger Liu
- AI: Tether (Claude Opus 5.5)
- Outcome: Both recommendations accepted by Tiger in conversation; answers recorded.

---

## Links

- Related ADRs: ADR-0001 (architecture & build), ADR-0002 (key handling — the key's storage is decided there, not here)
