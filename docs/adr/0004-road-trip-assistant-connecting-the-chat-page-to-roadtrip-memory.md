<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# Road-trip assistant — connecting the chat page to roadtrip-memory

- **Date**: 2026-11-19
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: Let the chat page use the roadtrip-memory MCP server directly from the browser. This needs three things settled first: how the page reaches the server, who is allowed to use the server, and how "never save without my OK" is enforced.

---

## Originating Context

**Source**: `Human dump (below)` — Tiger's message, 2026-11-19.

> New goal: turn this chat page into my road-trip travel assistant, connected to my road-trip memory.
>
> My memory server is already live: https://your-first-memory-00di.onrender.com/mcp — an MCP server with two tools, save_favorite(place, reason) and list_favorites(). Its code is in ~/roadtrip-memory, and my rules are in ~/roadtrip-memory/.claude/skills/my-ways/SKILL.md (only save travel places I say I like; if unsure, ask me first).
>
> What I want: when I chat about trips, the assistant can save places I love and read them back to help plan routes.
>
> Before writing any code: what are the 2–3 decisions we should settle first? Put them to me as QST cards with your recommendation. I'm a beginner, so please explain each option in simple words.

**Agency Grant**: Find the decisions, explain them simply, and recommend. No code until Tiger rules.

---

## Explicitation

**What I understand**:

1. **How it works in principle.** OpenRouter models can use *tools*. The page tells the model "you have `save_favorite` and `list_favorites`". When the model wants one, it replies with a tool request instead of text. The page runs that request against the memory server and sends the result back, and the model continues. The model never touches the server itself; **the page in your browser does all the calling.**
2. **What I checked on 2026-11-19** (against the live server and `~/roadtrip-memory/server.py`):
   - **A web page can't reach the server today.** Before a page on one site may call a server on another, the browser sends a "may I?" request (a CORS *preflight*, an `OPTIONS` request). The live server answers `405 Method Not Allowed` and names no allowed sites, so the browser will block every call from `tigerking-1314.github.io`. The code has no CORS handling (FastMCP defaults). **Any plan needs a small change to roadtrip-memory.** → QST-MCP-BRIDGE
   - **The server has no lock.** An `initialize` call from my terminal went through with no password or key. Anyone who learns the URL can list your favorites or add fake ones. → QST-MEMORY-LOCK
   - **The rules require a "yes" every time.** Your `my-ways` skill: *"Show me the `place` and `reason` you're about to save, and wait for my OK. Never save without it."* → QST-SAVE-OK
3. **The page can't read your skill file.** `my-ways/SKILL.md` lives on your laptop, inside the roadtrip-memory repo. The website can't open it, so the rules have to be **copied into the page** (as the road-trip assistant's instructions), and the two copies could drift apart over time. I'll add a comment in each copy pointing to the other.

**Assumptions** (tell me if any is wrong — none of them needs a question card):

- **Road-trip is a mode, not a takeover.** Each conversation gets a "Road-trip assistant" switch: on means the memory tools and the my-ways rules are active. Ordinary chats stay ordinary. (If you meant the whole page should only ever be the travel assistant, that's an easy change.)
- **Only tool-capable models.** Not every OpenRouter model can use tools. In road-trip mode the page will warn you if the chosen model can't.
- **Slow first call.** Render's free plan puts the server to sleep when idle, so the first call can take about 30 seconds. The page will show "waking up your memory…" rather than seeming frozen.
- **Reading is free, saving is gated.** Your rules let the assistant check `list_favorites` on its own before suggesting stops, so reading doesn't need a click. Only saving does (QST-SAVE-OK).

**Confirm**: Tiger — the three questions below, plus a glance at the assumptions.

---

## Questions

### QST-MCP-BRIDGE: How should the page get through to your memory server?
- Status: unanswered
- Why asking: today the browser blocks the chat page from talking to `your-first-memory-00di.onrender.com`. The server never says "web pages from tigerking-1314.github.io are allowed" (it answers the browser's "may I?" check with `405`). Something has to change, and where we change it decides how much code there is and where it lives.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Open the door for your page only**: add about 10 lines to `server.py` in roadtrip-memory so the server tells browsers "requests from `https://tigerking-1314.github.io` are allowed" (a *CORS allow-list*). The page then speaks MCP, the same language Claude uses with this server today. One server and one way of talking to it; the page asks the server which tools exist, so a third tool you add later shows up automatically. Needs a redeploy on Render (push to the repo).
- **B — Add a simple side door**: also add plain web addresses to the server, like "get my favorites" and "save a favorite" (a small *REST API*), each with the same allow-list, and have the page use those instead of MCP. The page code is a bit simpler, but you'd maintain two ways into the same data, and new tools must be wired into the page by hand.
- **C — Put a middleman in between**: run a tiny relay service (for example a free Cloudflare Worker) that the page talks to and that forwards to your server. The memory server stays untouched, but it's a third service to deploy and keep alive, and it goes against this project's "no backend" choice (ADR-0001).

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**A — Open the door for your page only.** *Rationale*: the server already speaks MCP (`mcp.run(transport="streamable-http")` in `server.py`), and FastMCP runs on Starlette, whose standard `CORSMiddleware` covers exactly this case. The page needs only three MCP messages (`initialize`, `tools/list`, `tools/call`). B duplicates the data path, and C adds a service to a project that chose to have none. One detail matters: the allow-list must also let the browser read the `mcp-session-id` header, because MCP uses it to keep a conversation with the server going. *Confidence*: 0.8 — because I verified the server's current behavior and the code, but haven't yet confirmed that the pinned `mcp` 1.x version lets you add middleware cleanly (it may need wrapping the app instead of calling `mcp.run()`). *If wrong*: if adding CORS to FastMCP 1.x turns out to be awkward, or breaks your existing Claude connection, this flips to B (the side door is plain Starlette routes, where CORS is routine).

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-MEMORY-LOCK: Who should be allowed to read and change your favorites?
- Status: unanswered
- Why asking: the server has no lock. Today anyone who knows its URL can list every place you saved, with your reasons, or add junk entries. That was fine while only Claude knew the URL. Once the chat page uses it, the URL sits in your browser settings, and the page is public. Note that the "allowed sites" fix in QST-MCP-BRIDGE is **not** a lock: it only controls web pages, and any script or terminal can ignore it, as my own test did. One more wrinkle: you also seem to have this server connected to claude.ai (I see a roadtrip-memory connector on your account), and any lock must not shut that connection out.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Leave it open**: no change. The data is a list of places you liked, which is low stakes, and the URL is long and unguessable. Risk: if the URL ever leaks (a screenshot, a shared chat, a log), anyone can read or scribble on your list, and you'd never know.
- **B — A secret key in the address**: the server only answers requests whose URL includes a long random secret, e.g. `…/mcp?key=k7Qx…`. You paste that full address once into the chat page's settings (stored in your browser, like your OpenRouter key) and once into the claude.ai connector settings. The secret goes into Render's environment variables, never into git (same rule as your `DATABASE_URL`, roadtrip-memory ADR-0003). It works with any client that lets you enter a URL.
- **C — A secret key in a header**: same idea as B, but the key travels in a hidden request header (`Authorization: Bearer …`) instead of the address. That's the more standard place, and it doesn't show up in server logs. But the claude.ai connector may have no box for a custom header, which could cut that connection off.
- **D — Real login (OAuth)**: the server asks you to sign in, the way "Connect OpenRouter" works. This is the proper way for a public server, and it's what claude.ai connectors are designed for, but it's several times more work than B or C and a project of its own.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**B — A secret key in the address.** *Rationale*: it closes the real gap (my unauthenticated test call succeeded) for about 10 lines of server code and one environment variable. It also keeps both the chat page and the claude.ai connector working, because both just take a URL. C is the textbook choice, but it risks breaking the claude.ai connector, and A leaves your list one leaked link away from strangers. The known weakness of B is that secrets in URLs can end up in logs, and here those are your own Render logs. *Confidence*: 0.65 — because I haven't checked whether your claude.ai connector can send custom headers (if it can, C is strictly better), and how much privacy matters for this list is your call. *If wrong*: if the claude.ai connector supports custom headers, flip to C; if you don't mind strangers possibly seeing your list, A is a fine choice and saves the work.

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-SAVE-OK: How do we make sure nothing is saved without your OK?
- Status: unanswered
- Why asking: your `my-ways` rules say *"Show me the place and reason you're about to save, and wait for my OK. Never save without it."* In the chat page, the model asks for a tool and **the page decides whether to run it**. So we choose whether the "OK" relies on the model behaving, or is built into the page so it can't be skipped. Cheaper models on OpenRouter don't always follow instructions faithfully.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Rules only, you answer in words**: copy your my-ways rules into the road-trip assistant's instructions. The model writes "Save Zion — 'Liked the hiking'? OK?" and only calls `save_favorite` after you type yes. Nothing new to build, but it relies on the model obeying: if it ever skips the question, the save just happens.
- **B — A Save button you must click**: the rules still go into the instructions, so the model proposes saves at the right moments and with your words. But when the model asks to save, the page doesn't save. It shows a card in the chat, **"Save Zion — 'Liked the hiking'?  [Save] [Don't save]"**, and only your click calls the server. The model can't save on its own, even by mistake.
- **C — Button only for unclear cases**: the model saves freely when it thinks you clearly said you like a place, and asks only when unsure. This is closer to "if unsure, ask me first" read loosely, but your skill file is stricter ("never save without it"), and it trusts the model's judgment about what counts as clear.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**B — A Save button you must click.** *Rationale*: your rules make the OK unconditional ("Never save without it"), and B is the only option where the page, not the model, enforces it. It's also an exact fit for how tool use works here (the page sits between the model's request and the server). The card shows the place and reason, which covers your rule's "show me what you're about to save" step for free. A is fine with a top model and fragile with a cheap one, and C contradicts your own skill file. *Confidence*: 0.85 — because it follows the text of your rules directly; the remaining doubt is whether a click per save will feel tedious on the road. *If wrong*: if the clicks get annoying in real use, add a per-conversation "save without asking" switch. That's a change to your rules, so it would be your call in a new question.

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

## Supporting Materials

### FIL: what was read
- `~/roadtrip-memory/server.py` — FastMCP 1.x, `streamable-http`, no CORS, no auth
- `~/roadtrip-memory/.claude/skills/my-ways/SKILL.md` — the save/read rules quoted above
- `~/roadtrip-memory/render.yaml` — free plan (sleeps when idle), `mcp[cli]>=1.2,<2` pinned
- `~/roadtrip-memory/docs/adr/0003-the-secret-lives-in-the-environment.md` — the secrets rule QST-MEMORY-LOCK B follows

### API: the 2026-11-19 probe (read-only)
**Request:** `OPTIONS /mcp` with `Origin: https://tigerking-1314.github.io`
**Response:** `405 Method Not Allowed`, no `Access-Control-Allow-Origin` → the browser blocks the page.

**Request:** `POST /mcp` (`initialize`), no credentials
**Response:** `200`, session granted, `serverInfo: your-first-memory 1.30.0` → no lock.

---

## Action Items

- [ ] Answer QST-MCP-BRIDGE, QST-MEMORY-LOCK, QST-SAVE-OK; glance at the assumptions - Owner: Tiger Liu
- [ ] Server changes in `~/roadtrip-memory` per the answers (its own ADR there) + redeploy - Owner: Tether, with Tiger's go for the push
- [ ] Page: road-trip mode, MCP client, tool loop, Save card, tests - Owner: Tether

---

## Iterations

### Iteration 1 (2026-11-19)
- Trigger: Tiger's road-trip assistant message
- Contributors: Tether (Claude Opus 5.5)
- Changes: read roadtrip-memory's code and rules; probed the live server (CORS blocked, no auth); minted three questions
- Outcome: Draft

---

## Glossary (optional)

- **MCP** (Model Context Protocol): a standard way for AI apps to call tools on a server; your memory server speaks it.
- **Tool call**: the model, instead of replying with text, asks the app to run a named tool with arguments.
- **CORS**: the browser's rule about which websites may talk to which servers; the *server* lists the sites it allows.
- **Preflight**: the browser's "may I?" request (`OPTIONS`) sent before the real one.

---

## Links

- Related ADRs: ADR-0001 (no backend), ADR-0002 (keys in localStorage, hardened page — the memory URL/secret will live the same way), ADR-0003 (persistence)
- Related code: `~/roadtrip-memory/server.py`, `~/roadtrip-memory/.claude/skills/my-ways/SKILL.md`
