<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# Static chat harness on GitHub Pages — scope, architecture and build

- **Date**: 2026-11-12
- **Iteration**: 3
- **Status**: Accepted
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: Build the harness as a no-build, vanilla-JS static site served by GitHub Pages, scoped as "chat with knobs", with `node --test` over pure modules as the project gate — pending Tiger's answers below.

---

## Originating Context

**Source**: `Human dump (below)` — Tiger's founding message, 2026-11-12.

> I want to build a simple harness: a chat page interface online.
>
> - GitHub Pages only (no backend)
> - OpenRouter API keys through CORS on the front-end
> - storage in local storage

Sibling threads chunked from the same dump: key handling → ADR-0002; persistence → ADR-0003.

**Agency Grant**: Explore options and recommend; Tiger rules.

---

## Explicitation

**What I understand**:

1. **No backend, ever** (for now) — every byte the app needs is static; all dynamic behavior happens in the visitor's browser, talking straight to `openrouter.ai`. This removes servers, secrets-on-server and hosting cost, and moves *all* trust to the browser (see ADR-0002).
2. **"Simple harness"** — a chat page. "Harness" can mean anything from a chat box to an agent loop with tools; the word sets scope, so it is asked below (QST-SCOPE).
3. **The build pipeline is a real decision**: GitHub Pages can serve files straight from a branch (no build), or serve the output of a GitHub Actions build. That choice decides how tests run and what the gate (Fifth Directive) can be.

**Assumptions**:

- The repo will be public (GitHub Pages on a free account requires it) — so *nothing secret may ever be committed*; this is load-bearing for ADR-0002.
- The site is served at `https://tigerking-1314.github.io/my-hardness-project/` unless renamed or given a custom domain (QST-NAME).
- One human user primarily (Tiger), but anyone with the URL can use it with their own key.

**Confirm**: Tiger — especially QST-SCOPE, which sizes everything else.

---

## Questions

### QST-SCOPE: How much "harness" is in the chat harness for v1?
- Status: answered
- Why asking: "harness" could mean a plain chat box or a tool for driving/comparing models. The answer sizes the UI, the data model in ADR-0003 (what a saved conversation contains), and how much there is to test. Context: OpenRouter exposes hundreds of models behind one OpenAI-compatible endpoint, so model choice is nearly free to offer.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Plain chat**: model picker, send a message, streamed reply, conversation list. Nothing else.
- **B — Chat with knobs**: A, plus per-conversation system prompt, temperature/max-tokens, and a visible token/cost readout per reply (OpenRouter returns usage). The "harness" is the knobs.
- **C — Agent harness**: B, plus tool/function calling executed in the browser (e.g. a calculator, fetch-a-URL), multi-step loops. Substantially more code and a much larger trust surface.
- **D — Model workbench**: B, plus sending the same prompt to 2+ models side by side for comparison.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**B — Chat with knobs.** *Rationale*: the dump says "simple", which rules out C as a v1; but "harness" rather than "chat app" suggests Tiger wants control over *how* the model is driven, and B's knobs are each a few lines on top of A (the request body already carries `model`, `messages`, `temperature`; `usage` comes back in the response). D is a natural v2 that B's data model can grow into. *Confidence*: 0.6 — because I'm inferring intent from one word; this is squarely Tiger's call. *If wrong*: if Tiger meant "harness" as in test harness / agent harness (driving models through tasks), this flips to C, and ADR-0002's security posture must be revisited before any tool runs in the page.

**ANS:** (by Tiger Liu)
B — Chat with knobs. Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

### QST-BUILD: No-build vanilla JS, or a bundled (Vite/TypeScript) build deployed by Actions?
- Status: answered
- Why asking: decides the repo layout, how GitHub Pages is configured, and what the test gate can run. Context: Pages can either serve a branch folder as-is, or serve an artifact produced by a GitHub Actions workflow.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — No build**: plain `index.html` + native ES modules + CSS, served directly from the repo (e.g. a `site/` folder via a tiny Pages workflow, or branch root). Zero dependencies; what you commit is what runs. Tests: `node --test` imports the same `.js` modules (pure logic only — parsing, storage, request building).
- **B — Vite + TypeScript**: `npm` project, typed code, bundling/minification, built in GitHub Actions and deployed to Pages. Type safety and a dev server with hot reload; adds `node_modules`, a lockfile, and a build step between commit and site.
- **C — Framework (Svelte/React) + Vite**: B plus a UI framework. Component model for a richer UI; the most dependencies and the most to learn/maintain for a "simple" page.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — No build.** *Rationale*: the whole app is roughly one page, a streaming `fetch`, a markdown renderer and a storage module — small enough that a build step buys little. It also shrinks the attack surface that matters most here (ADR-0002: anything that runs on the page can read the stored key): with no dependency tree there is no supply chain to audit. And for a first deliberately-built project, "the file you read is the file that runs" keeps the loop short. JSDoc type comments can recover some of B's safety later without a build. *Confidence*: 0.7 — because the app is small today; that is the assumption most likely to change. *If wrong*: if QST-SCOPE lands on C or D, or the UI grows past ~1,500 lines of JS, this flips to B (TypeScript earns its keep once state gets complicated).

**ANS:** (by Tiger Liu)
A — No build. Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

### QST-NAME: Keep the repo name `my-hardness-project`, or rename before the URL goes public?
- Status: answered
- Why asking: the project is a *harness*; the repo says *hardness* — possibly a typo, possibly deliberate. On GitHub Pages the repo name becomes the public URL path (`tigerking-1314.github.io/<repo>/`), and renaming after people bookmark it breaks their links — and because localStorage is per-origin (not per-path), a rename keeps the stored data, but a move to a custom domain loses it. Cheapest to settle now.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Keep it**: `my-hardness-project` stays; the URL is `…github.io/my-hardness-project/`.
- **B — Rename the repo**: e.g. `harness` or `chat-harness` (Tiger's choice of name); GitHub redirects the git remote, the Pages URL changes once.
- **C — Keep repo, custom domain later**: name doesn't matter because the site will live on a custom domain (also isolates storage — see ADR-0002 QST-ORIGIN).

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**B — Rename the repo.** *Rationale*: if "hardness" is a typo, it will be in every URL and every record forever; today it costs one rename and nothing has been published. *Confidence*: 0.5 — because I genuinely can't tell whether the name is intended; route to Tiger. *If wrong*: if the name is deliberate (a pun, or just doesn't matter to Tiger), A — and I'll stop noticing it.

**ANS:** (by Tiger Liu)
B — Rename the repo. Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.") The new name itself was not given — see the follow-up question.

---

### QST-GATE: What is the project's test gate once code exists?
- Status: answered
- Why asking: the Fifth Directive requires a real gate before every commit; CLAUDE.md currently names `just gate` (substrate checks only). The app's riskiest code is invisible in a browser demo: parsing OpenRouter's streamed SSE chunks, saving/loading conversations, and never persisting or logging the key wrongly.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Unit gate**: `node --test` (built into Node, zero deps) over the pure modules, wired into `just gate`. Fast, runs anywhere; doesn't exercise the real DOM.
- **B — Unit + browser e2e**: A plus Playwright tests driving the real page against a mocked OpenRouter. Catches UI wiring bugs; adds a dependency and minutes per run.
- **C — Manual**: smoke-test in the browser before pushing. No tooling; nothing enforces it.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — Unit gate.** *Rationale*: it pairs with QST-BUILD A (no dependencies) and covers exactly the code where a silent bug costs a conversation or a key; the UI is thin enough to check by eye at this size. *Confidence*: 0.75 — because this is the standard shape for small static apps, though it leaves the DOM layer untested. *If wrong*: if a UI regression ships that a test would have caught (e.g. a send button that silently does nothing), add B.

**ANS:** (by Tiger Liu)
A — Unit gate (`node --test` over the pure modules, wired into `just gate`). Accepted Tether's recommendation (in conversation, 2026-11-12: "I accept all your recommendations.")

---

## Decision

*Accepted 2026-11-12 (all recommendations, Tiger Liu): B chat-with-knobs · A no build · B rename · A unit gate.*

- `site/index.html`, `site/app.js`, `site/*.js` modules (`openrouter.js` — request + SSE stream parsing; `store.js` — persistence per ADR-0003; `keys.js` — per ADR-0002), `site/style.css`.
- A GitHub Actions workflow publishes `site/` to Pages (keeps docs, ADRs and tests out of the served site).
- `tests/*.test.js` run by `node --test`, added to the `gate` recipe in the `justfile`.

---

## Open Follow-ups

### QST-NEW-NAME: What should the repo be renamed to?
- Status: answered
- Why asking: QST-NAME was answered "B — rename", but the name itself wasn't given. The repo name becomes the public URL path (`tigerking-1314.github.io/<name>/`). The code doesn't depend on it (all paths are relative, and the OAuth callback URL is computed from the page's own address), so building proceeds meanwhile. Renaming is one click in GitHub → Settings → General, or `gh repo rename <name>`; the local git remote should then be updated.
- Need: pick a letter (or override — any name answers)

Options:
- **A — `chat-harness`**: says what it is; URL `…github.io/chat-harness/`.
- **B — `harness`**: shortest; URL `…github.io/harness/`.
- **C — `my-harness-project`**: closest to the current name, typo fixed.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-12)

**A — `chat-harness`.** *Rationale*: a URL other people may see should say what the page is; "harness" alone is ambiguous (ADR-0001 QST-SCOPE needed a question just to pin its meaning). *Confidence*: 0.5 — because naming is taste, and it's yours. *If wrong*: if you'd rather keep continuity with the name you chose, C.

**ANS:** (by Tiger Liu)
my-harness-project

---

## Action Items

- [x] Answer QST-SCOPE, QST-BUILD, QST-NAME, QST-GATE - Owner: Tiger Liu
- [x] Answer QST-NEW-NAME (`my-harness-project`) - Owner: Tiger Liu
- [x] Rename the repo, push, enable GitHub Pages (source: GitHub Actions) — done by Tether on Tiger's go, 2026-11-12; live at https://tigerking-1314.github.io/my-harness-project/ - Owner: Tether
- [x] Scaffold per the answers; wire the test gate into `justfile` - Owner: Tether
- [ ] Test the live site end-to-end, including "Connect OpenRouter" (the one path no test covers) - Owner: Tiger Liu

---

## Iterations

### Iteration 1 (2026-11-12)
- Trigger: initial draft from Tiger's founding message
- Contributors: Tether (Claude Opus 5.5)
- Changes: chunked the dump into three ADRs (this, 0002, 0003); four questions minted here
- Outcome: Draft

### Iteration 2 (2026-11-12)
- Human: Tiger Liu
- AI: Tether (Claude Opus 5.5)
- Outcome: All four recommendations accepted by Tiger in conversation; answers recorded. Build proceeds per the Decision section.

### Iteration 3 (2026-11-12)
- Trigger: Tiger answered QST-NEW-NAME (`my-harness-project` — option C) and said go for rename + push + Pages
- Contributors: Tiger Liu, Tether (Claude Opus 5.5)
- Changes: repo renamed `my-hardness-project` → `my-harness-project`; Pages enabled (build_type: workflow); first deploy green (tests job → deploy job). The old URL `…/my-hardness-project/` now 404s (Pages does not redirect renamed project sites); localStorage is per-origin, so nothing stored is lost by the rename.
- Outcome: v1 live at https://tigerking-1314.github.io/my-harness-project/

---

## Links

- Related ADRs: ADR-0002 (OpenRouter key handling), ADR-0003 (browser persistence)
