<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# Desert-sunset road-trip look for the chat page

- **Date**: 2026-11-24
- **Iteration**: 2
- **Status**: Implemented
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: Restyle the chat page as "Tiger's Road-Trip Assistant" with a desert-sunset theme, using only local SVG art so the current CSP stays exactly as it is. Tiger picks one of three visual directions before anything is built.

---

## Originating Context

**Source**: `Human dump (below)` — Tiger's message, 2026-11-24.

> I want the chat page to look like a road-trip app, not a plain chat. Style: desert sunset — sand background with a faint topographic-map texture, a sunset gradient header with a mountain silhouette, red-rock sidebar, a dashed-road empty state saying "Where to next?", a visible "Road-trip mode" badge when the switch is on, and a desert night sky for dark mode. Rename the page "Tiger's Road-Trip Assistant". Keep the current CSP: all art must be local SVG, no outside fonts or images. Show me 2–3 options as a QST before building, then push.

**Agency Grant**: Offer 2–3 directions; build the one Tiger picks; then push (a push to `main` deploys to GitHub Pages).

---

## Explicitation

**What I understand**:

1. **Every direction must have all seven parts of the brief**: sand + faint topo texture, sunset-gradient header with a mountain silhouette, red-rock sidebar, dashed-road empty state reading "Where to next?", a "Road-trip mode" badge, a desert night sky in dark mode, and the new name. The options differ in *how loud* the theme is and in its *character*, not in which parts are included.
2. **The CSP is fixed** (`site/index.html`: `default-src 'none'; style-src 'self'; img-src 'self' data:`). What that allows: SVG files in `site/` used as CSS backgrounds, and SVG written straight into the HTML. What it blocks: web fonts, outside images, `<style>` blocks, and `style="…"` attributes, including inside an inline SVG. So all colour goes in `style.css` or in SVG `fill=` attributes, and fonts come from the system font stack.
3. **The badge follows the conversation.** The road-trip switch is saved per conversation (`current.roadtrip` in `site/app.js`), so the badge appears and disappears when you switch between chats. That matches what the switch does. A single global badge would be wrong.

**Assumptions** (say so if any are wrong):

- "Rename the page" covers the browser-tab `<title>`, a visible title in the header, and `APP_TITLE` in `site/app.js`. `APP_TITLE` is sent to OpenRouter as the app name (`X-Title`), so OpenRouter's activity page will show the new name too.
- Dark mode still follows the device setting (`prefers-color-scheme`). There's no manual toggle.
- The theme is purely visual. Nothing about keys, storage or the memory server changes, so no new tests: CLAUDE.md marks `site/app.js` as DOM glue checked in a browser, and the Fourth Directive rules out tests that only assert a colour.

**Doubt (Secondary Directive)**: An untracked `tests/geo.test.js` (ADR-0005 work in progress) imports a `site/geo.js` that doesn't exist yet, so `just gate` is red in the shared worktree right now. The cause isn't this ADR. This work is staged by path and doesn't include that file. Before pushing, the gate runs on the committed tree. It is not made green by deleting someone else's file.

---

## Questions

### QST-LOOK: Which desert-sunset direction should the page take?
- Status: answered
- Why asking: The look is your taste, not a technical call. All three options include every part of the brief and keep the CSP unchanged. They differ in how much screen the scenery takes and in its character.
- Need: pick a letter (or override — any shape answers, e.g. "A but with C's empty state")

Options:
- **A — Big Sunset**: A tall (~96px) header with a full sunset gradient (gold → orange → rose → dusk purple) and two layers of mesa silhouettes along its bottom edge. The page title sits on the sky, and the model, Settings and key controls run in a translucent strip below. Deep red-rock sidebar with faint sandstone strata lines. Warm sand background with topo contours at ~7% opacity. Empty state: a dashed road winding up to a small sun on the horizon, with "Where to next?" in large serif type. Dark mode: an indigo-to-black sky with stars and a moon over the same mesas, and the sand turns to dark umber. On phones the header shrinks to ~64px. Choose this if you want it to *feel* like a travel app the moment it opens.
- **B — Trail Map**: A slim (~56px) header with the same gradient and a single thin mountain ridge line. Here the topo-map texture is the hero: more visible (~12%) and also faintly on the sidebar. Flat terracotta sidebar. Empty state: a dotted map route from a start dot to a map pin, labelled "Where to next?". Dark mode: a navy sky with sparse stars in the header, and the contours glow faintly on dark sand. Choose this for long chats: it's the calmest option and leaves the most room for messages.
- **C — Retro Postcard**: A 1970s postcard header: a half-sun cut by horizontal stripes setting behind mesas, with chunky rounded title type. Red-rock sidebar with a stitched dashed edge. The "Road-trip mode" badge is shaped like a generic highway shield. Empty state: a two-lane road in one-point perspective with centre dashes vanishing at the horizon. Dark mode: a deep purple night with a big pale moon and stars. Choose this for the most character. It also gets kitschy fastest.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-24)

**A — Big Sunset.** *Rationale*: A follows the brief most literally. "A sunset gradient header with a mountain silhouette" only reads as a scene with some height, and B's 56px strip turns it into a coloured bar. A's phone rule (header down to ~64px, `@media (max-width: 760px)` in `site/style.css`) keeps that height from crowding messages on small screens. C adds a strong motif (the striped sun) that you didn't ask for. *Confidence*: 0.6 — because this is a taste call I can't check against any evidence in the repo, only against the wording of the brief. *If wrong*: if you mostly use the page on your phone or in long sessions and the scenery starts to feel in the way, flip to **B**. If you want it to look like a souvenir rather than a tool, flip to **C**.

**ANS:** (by Tiger Liu, 2026-11-24)
A — Big Sunset.

---

## Supporting Materials

### FIL: files the restyle touches
- `site/index.html` — `<title>`, header markup, the badge element. The CSP line stays byte-for-byte the same.
- `site/style.css` — palette (light + dark), header, sidebar, empty state, badge.
- `site/app.js` — `APP_TITLE`, the empty-state markup in `renderMessages()`, and badge visibility in `renderParams()`.
- `site/art/*.svg` — new local art (topo texture, mesas, road, stars).

---

## Decision

### Chosen: A — Big Sunset (Tiger, 2026-11-24)

**What was built**:
- **Header** (`.masthead` in `site/index.html`): a 96px sky (64px on phones) with the page title. The sky is drawn by CSS gradients for the sky and sun, with `art/mesas.svg` on top. Below it, a sand-coloured control strip. In dark mode it's a night gradient, `art/stars.svg`, a CSS-gradient moon and `art/mesas-night.svg`.
- **Sidebar**: a red-rock gradient with `art/strata.svg` on top. Light text, a sand-coloured "+ New chat" button, and a gold edge on the active conversation.
- **Background**: sand with `art/topo.svg` contours (`art/topo-night.svg` on dark umber). The rings scale around drifting points, so they read as slopes, not bullseyes. That was the first draft's problem, caught in a screenshot.
- **Empty state** (`renderMessages()` in `site/app.js`): `art/road.svg` (an S-bend road with a dashed centre line, running to a sun on the horizon). A `<picture>` swaps in `art/road-night.svg` in dark mode. Under it: "Where to next?" and a one-line hint.
- **Badge**: `#roadtrip-badge` (a sunset-gradient pill with `art/pin.svg`) shows exactly when the current conversation's road-trip switch is on. It's set in `renderParams()` and in the switch's change handler.
- **Name**: `<title>`, the header `h1`, and `APP_TITLE`, which is also the `X-Title` OpenRouter shows.
- **CSP**: unchanged, byte for byte. The art is 9 local SVG files under `site/art/`, used through `img-src 'self'`. No `style=` attributes, no web fonts: the serif is a system stack (Iowan Old Style / Palatino / Georgia).

**Trade-offs accepted**: The header takes 96px of height on desktop. That's the cost of A over B, and why it shrinks to 64px on phones.

---

## Action Items

- [x] Answer QST-LOOK - Owner: Tiger Liu
- [x] Build the chosen direction, check light and dark in a browser, run the gate, push - Owner: Tether. Checked with headless-Chrome screenshots at 1280px, light and dark, plus the badge forced on in a scratch copy.
- [ ] Tiger's eye on a real phone. Headless Chrome won't lay out narrower than ~500px, so the 390px phone view isn't confirmed - Owner: Tiger Liu

---

## Iterations

### Iteration 1 (2026-11-24)
- Trigger: Tiger's message (Originating Context)
- Contributors: Tiger Liu, Tether (Claude Opus 5.5)
- Changes: Three directions laid out under QST-LOOK, with a recommendation
- Outcome: Draft; building waits on Tiger's pick

### Iteration 2 (2026-11-24)
- Trigger: Tiger answered QST-LOOK: A
- Contributors: Tiger Liu, Tether (Claude Opus 5.5)
- Changes: Built A (see Decision). Screenshots caught two first-draft problems: the topo texture read as bullseyes, and the road as a shark fin. Both were redrawn. Gate: all 61 tracked tests pass. The shared worktree's untracked `tests/geo.test.js` (ADR-0005 work in progress, its `site/geo.js` not written yet) still fails on its own. It is left untouched and is not part of this push.
- Outcome: Draft → Implemented; pushed to `main` (deploys to Pages)

---

## Links

- Related ADRs: ADR-0001 (static site, CSP), ADR-0002 (why the CSP is strict: the key lives in this origin), ADR-0004 (road-trip mode)
- Related code: `site/index.html`, `site/style.css`, `site/app.js`
