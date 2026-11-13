<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# OpenRouter access from the browser — whose key, how it's obtained, how it's kept

- **Date**: 2026-11-12
- **Iteration**: 2
- **Status**: Accepted
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: Every visitor uses their *own* OpenRouter key — obtained via OpenRouter's OAuth PKCE "connect" flow (paste-a-key as fallback) — never a key committed to the repo; the key lives in localStorage on a page hardened against script injection.

---

## Originating Context

**Source**: `Human dump` — Tiger's founding message, 2026-11-12 (full text in ADR-0001). The line this ADR chunks:

> OpenRouter API keys through CORS on the front-end

**Agency Grant**: Explore options and recommend; Tiger rules.

---

## Explicitation

**What I understand**:

1. **The browser calls `https://openrouter.ai/api/v1/chat/completions` directly.** OpenRouter permits cross-origin requests from browsers, so no proxy is needed. The request carries `Authorization: Bearer <key>`.
2. **Therefore the key is in the browser — always.** With no backend, there is no place to hide a secret. Whatever key the page uses, the person at the keyboard (and any script running on the page) can read it. This is the single most important fact in the project, and it drives QST-KEY-OWNER.
3. **OpenRouter offers an OAuth PKCE flow for exactly this situation.** Verified 2026-11-12 against `https://openrouter.ai/docs/use-cases/oauth-pkce`: redirect the user to `https://openrouter.ai/auth?callback_url=<site>&code_challenge=<S256 challenge>&code_challenge_method=S256`; they log in and approve; OpenRouter redirects back with `?code=…`; the page `POST`s `{code, code_verifier, code_challenge_method}` to `https://openrouter.ai/api/v1/auth/keys` and receives `{key}` — a key on *the user's own* account and credits. No client secret involved; codes expire after 10 minutes.

**Assumptions**:

- The repo is public (ADR-0001), so any key committed to it is public within minutes — automated scrapers watch GitHub for API keys.
- Visitors other than Tiger may use the page.

**Confirm**: Tiger — QST-KEY-OWNER first; it may change what "OpenRouter API keys" meant in the dump.

---

## Questions

### QST-KEY-OWNER: Whose OpenRouter key pays for the chats, and how does the page get it?
- Status: answered
- Why asking: the dump says "OpenRouter API keys through CORS on the front-end" without saying whose. With no backend, any key the page uses is readable by whoever loads the page. If the intent was "Tiger's key, built into the site so it just works", that cannot be done safely — anyone could copy the key and spend Tiger's credits.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Paste your own key**: a settings field where each user pastes a key they created at openrouter.ai/keys. Simple; asks users to handle a raw secret.
- **B — Connect with OpenRouter (OAuth PKCE)**: a "Connect OpenRouter" button; user logs in on openrouter.ai, approves, and the page receives a key for their own account. No copy-pasting secrets; a few dozen lines of code (Web Crypto for the challenge, one `POST` for the exchange).
- **C — Tiger's key embedded in the site**: the key is committed or injected at build time so visitors need nothing. **Unsafe on a public static site**: the key is downloadable by anyone, and abuse is billed to Tiger. Listed so the option is ruled on, not silently absent.
- **D — B with A as fallback**: "Connect" is the main path; an "I have a key" link opens the paste field (useful for keys with spending limits created by hand).

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**D — Connect with OpenRouter, paste as fallback.** *Rationale*: B is the flow OpenRouter built for keyless frontends (docs verified today, see Explicitation 3); it also gives the nicest first-run. Keeping A as a fallback covers a key Tiger creates by hand with a credit limit — a useful safety rail for experimentation. C is ruled out on the facts, not on taste. *Confidence*: 0.8 — because the PKCE flow is documented and the alternative's risk is concrete; not higher because I haven't run the flow end-to-end from a `github.io` origin yet. *If wrong*: if the PKCE redirect or the key exchange fails from a GitHub Pages origin (CORS on `/api/v1/auth/keys`, or callback URL restrictions), this flips to A until fixed.

**ANS:** (by Tiger Liu)
D — Connect with OpenRouter (OAuth PKCE), paste-a-key as fallback. Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

### QST-KEY-PERSIST: Should the key persist across visits (localStorage), or only for the session?
- Status: answered
- Why asking: the dump says storage is localStorage. For conversations that is clearly right; for the *key* it is a trade: localStorage survives closing the browser (convenient) but is readable by any script that ever runs on this origin, indefinitely (an XSS bug, a compromised CDN script, a malicious browser extension).
- Need: pick a letter (or override — any shape answers)

Options:
- **A — localStorage, hardened**: key persists. Mitigations: no third-party scripts at all, a strict Content-Security-Policy `<meta>` tag (scripts only from this site; network only to `openrouter.ai`), model output rendered as sanitized markdown (never raw `innerHTML`), and a visible "Forget key" button.
- **B — sessionStorage**: key lives until the tab closes; re-connect every visit (with PKCE this is one click, not a paste).
- **C — "Remember me" checkbox**: B by default, A when the user opts in.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — localStorage, hardened.** *Rationale*: it matches the dump's stated design; the hardening list is cheap in a no-build app (ADR-0001 QST-BUILD A means there is no dependency tree to sneak a script in); and the real XSS vector in a chat app — rendering model output as HTML — is closed by sanitizing. Keys created via PKCE or by hand can carry credit limits on openrouter.ai, which caps the worst case. *Confidence*: 0.65 — because it's a genuine convenience-vs-exposure trade, and depends on QST-ORIGIN. *If wrong*: if Tiger's GitHub account will also host pages Tiger doesn't fully control (see QST-ORIGIN), or a markdown/rendering dependency becomes necessary, flip to C.

**ANS:** (by Tiger Liu)
A — localStorage, hardened (no third-party scripts, strict CSP, sanitized rendering, "Forget key" button). Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

### QST-ORIGIN: Accept sharing the `tigerking-1314.github.io` origin with every other Pages site on the account?
- Status: answered
- Why asking: a non-obvious GitHub Pages fact — **all project sites on one account share one origin**: `tigerking-1314.github.io/my-hardness-project/` and `tigerking-1314.github.io/any-other-repo/` are the *same origin* to the browser (the path doesn't count). So any other Pages site Tiger publishes — now or later, including a template or demo with third-party scripts — can read this app's localStorage, key included, and they share one storage quota (~5 MB).
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Accept**: all Pages sites on the account are Tiger's own; treat them as one trust zone and keep them free of untrusted scripts.
- **B — Custom (sub)domain**: serve the harness from e.g. `chat.<a domain Tiger owns>` — its own origin, own storage, own quota. Needs a domain and a DNS record.
- **C — Dedicated GitHub account/org**: publish from an organization used only for this app, giving it its own `<org>.github.io` origin. Free; one more account to manage.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — Accept, knowingly.** *Rationale*: today there is one Pages site on the account and Tiger controls everything on it; B/C solve a problem that doesn't exist yet. Writing the fact down here is the actual mitigation — it turns a silent risk into a rule ("no untrusted scripts on any Pages site of this account"). *Confidence*: 0.7 — because it's correct for now and depends on Tiger's future Pages use, which I can't see. *If wrong*: the moment a second Pages site on this account runs code Tiger didn't write (or a third-party widget), flip to B or C.

**ANS:** (by Tiger Liu)
A — Accept the shared github.io origin, knowingly: no untrusted scripts on any Pages site of this account. Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

## Decision

*Accepted 2026-11-12 (all recommendations, Tiger Liu): D connect-with-OpenRouter + paste fallback · A localStorage, hardened · A accept shared origin. Settled facts:*

- Requests go directly to `https://openrouter.ai/api/v1/chat/completions` with `stream: true`, read via `fetch` + `ReadableStream` (Server-Sent Events). The optional `HTTP-Referer` / `X-Title` headers identify the app on the user's OpenRouter activity page.
- **No key is ever committed to this repo** — not in code, not in tests, not in docs. Tests use fake keys and a mocked `fetch`.
- The key is never logged to the console or included in exported conversation files (ADR-0003).

---

## Action Items

- [x] Answer QST-KEY-OWNER, QST-KEY-PERSIST, QST-ORIGIN - Owner: Tiger Liu
- [ ] Spike the PKCE flow from a `github.io` origin before building the UI around it (verifies the If-wrong of QST-KEY-OWNER) - Owner: Tether
- [ ] Optional: create an OpenRouter key with a small credit limit for development - Owner: Tiger Liu

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from Tiger's founding message (chunked from ADR-0001's source)
- Contributors: Tether (Claude Opus 5.5)
- Changes: three questions minted; OpenRouter PKCE docs checked
- Outcome: Draft

### Iteration 2 (2026-11-12)
- Human: Tiger Liu
- AI: Tether (Claude Opus 5.5)
- Outcome: All three recommendations accepted by Tiger in conversation; answers recorded. PKCE spike next.

---

## Glossary (optional)

- **CORS**: the browser rule that decides whether a page on one site may read responses from another; OpenRouter allows it, which is what makes "no backend" possible.
- **PKCE** (OAuth "Proof Key for Code Exchange"): a login handshake for apps that can't keep a secret — the page proves it started the login by revealing a random value whose hash it sent earlier.
- **Origin**: scheme + host + port (e.g. `https://tigerking-1314.github.io`). Browser storage is partitioned by origin, not by path.
- **XSS**: getting attacker-controlled script to run on a page — on this app, it would mean reading the stored key.

---

## Links

- Related ADRs: ADR-0001 (architecture & build), ADR-0003 (browser persistence)
- DOC: https://openrouter.ai/docs/use-cases/oauth-pkce
