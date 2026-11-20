<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# Geographical memory, map pins, and private location

- **Date**: 2026-11-19
- **Iteration**: 1
- **Status**: Draft
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: Give each favorite real coordinates, show the favorites as pins on a map, and let the assistant know which favorites are near you. Two rules are fixed: nothing is saved without your click, and your location stays private.

---

## Originating Context

**Source**: `Human dump (below)` — Tiger's message, 2026-11-19, relaying their professor's suggestions.

> My professor suggested three things: (1) geographical memory, (2) Pinterest-style pins on a map, (3) use my location so the AI knows what I like around me. Please write ADR-0005 with QST cards for these, in that order. Keep the Save-only-when-I-click rule, and treat my location as private.

**Agency Grant**: Write the questions with recommendations, in the professor's order. No code until Tiger rules.

---

## Explicitation

**What I understand**:

1. **Geographical memory.** Today a favorite is just words: `place` ("Big Sur") and `reason` (roadtrip-memory `server.py`, table `favorites`). The memory doesn't know *where* Big Sur is, so it can't answer "what's near here?" or draw a map. Every favorite needs **coordinates** (latitude/longitude). → QST-GEO-COORDS
2. **Pins on a map, Pinterest-style.** Pinterest means a wall of picture cards. "On a map" means each card is also a pin at its place. Two things to settle: how the map is drawn (→ QST-MAP-STYLE) and whether pins carry photos (→ QST-PIN-PHOTOS).
3. **"Around me".** The browser can ask your phone or laptop where you are (the Geolocation API; the browser always shows its own "Allow location?" prompt first). The real question is **who gets to see that location**: the model provider via OpenRouter, your memory server, or nobody. → QST-LOCATION-SHARE

**Fixed rules (Tiger's instructions, not up for a vote)**:

- **Save only when I click** (carried over from ADR-0004 QST-SAVE-OK). Coordinates, pins, and "save the place I'm at now" all go through the Save card. The card now also shows *where* the place is, so you can catch "wrong Springfield" before it's saved.
- **Location is private**, which in this design means:
  - read **only when you tap a 📍 button** for one message, never in the background;
  - **never stored**: not in localStorage, not in the saved conversation, not in exports, not on the memory server;
  - **never put inside a chat message**. If location context goes to the model at all, it rides along as a one-time note that is not saved in the history. (Otherwise it would be stored in the chat and resent with every later message.)
  - **"Near me" is worked out in your browser**: the page fetches your favorites with their coordinates and measures distances on your device. So the memory server needs **no** "favorites near (lat, lon)" tool, because that tool would mean sending your location to the server.

**Assumptions**:

- **Server changes are small.** The `favorites` table gets two optional columns, `lat` and `lon`, so old rows stay valid. `save_favorite` accepts them, and `list_favorites` returns them. This is roadtrip-memory's own ADR-0007 when built (`CREATE TABLE IF NOT EXISTS` won't add columns to an existing table, so it needs a small `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- **Existing favorites get coordinates later**, through the same lookup plus a Save click each (no silent bulk update).
- **Your my-ways rules need one new line** (when to look up coordinates). That file is yours to edit, so I'll propose the wording rather than change it. Its copy in `site/tools.js` follows (ADR-0004).

**Confirm**: Tiger — the four questions below; the fixed rules are written from your message, so check they say what you meant.

---

## Questions

### QST-GEO-COORDS: How does a favorite get its coordinates?
- Status: unanswered
- Why asking: to put a place on a map or measure "how far", the memory needs its latitude and longitude, not just its name. Someone, or something, has to turn "Big Sur" into numbers, and names are ambiguous ("Springfield" exists in 30+ US states). Saves happen from two places, this chat page and claude.ai, and both should get coordinates.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — The model guesses**: the AI writes the coordinates itself when it calls `save_favorite`. Nothing new to build, but models misremember coordinates (sometimes by many kilometres), and nobody would notice until the pin lands in the wrong place.
- **B — The page looks it up**: before showing the Save card, the chat page asks a free map-lookup service (OpenStreetMap's Nominatim) "where is Big Sur?" and puts the answer on the card. Accurate, but it works **only in the chat page**: places saved from claude.ai get no coordinates.
- **C — The memory server looks it up**: add a read-only tool `find_place(name)` to the memory server. It asks Nominatim and returns the top few matches (name, region, coordinates). The model picks the right match and proposes the save with those coordinates, and your Save card shows "Big Sur, Monterey County, CA (36.27, -121.81)". It works from **both** the page and claude.ai, because the server does the lookup.
- **D — You drop the pin yourself**: when saving, a small map opens and you click where the place is. Most accurate, and needs no lookup service, but it adds work to every save, and claude.ai can't show a map.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**C — The memory server looks it up.** *Rationale*:
- It is the only option where saves from claude.ai also get coordinates. That client is real: you connected it, and it now needs `?key=` (ADR-0004).
- The ambiguity problem is handled by your existing rule: the Save card shows the matched place and region, and your click is the check.
- Lookups happen once per save, triggered by you, which is well within Nominatim's policy (https://operations.osmfoundation.org/policies/nominatim/, read 2026-11-19): at most 1 request per second, an identifying User-Agent (the server sends "roadtrip-memory/…"), no search-as-you-type (`find_place` runs only when the model proposes a save, never per keystroke), cache results (the coordinates stored with the favorite *are* the cache), and visible OpenStreetMap credit.
- A risks silently wrong pins. B leaves claude.ai saves without coordinates. D makes every save a chore.

*Confidence*: 0.75 — because the policy fits and C covers both clients, but I haven't checked how well Nominatim handles casual names ("the pie diner on Route 66"). *If wrong*: if lookups often miss or pick wrong places in practice, add D as the fallback ("not right? drop the pin yourself") on the page's Save card, which makes it C + D.

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-MAP-STYLE: What should the map view look like?
- Status: unanswered
- Why asking: "Pinterest-style pins on a map" can mean a real zoomable map, a wall of cards, or both side by side. The choice also decides which outside services the page must load from, and that matters for safety. ADR-0002 keeps the page's security policy tight (`script-src 'self'`) because your OpenRouter key lives in this page's storage.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Real map with pins**: a zoomable map (the free Leaflet library, **copied into this repo** so no outside script ever runs) drawing OpenStreetMap's map images, with one pin per favorite. Click a pin → its place and reason. Needs the security policy to allow images from `tile.openstreetmap.org`, plus a visible "© OpenStreetMap" credit.
- **B — Pin board, no map**: a Pinterest-like grid of cards (place, reason, date, distance from you if you've shared location), grouped by region, each with an "open in maps" link. Nothing loads from outside at all; but there's no actual map to look at.
- **C — Board + map together**: B's card grid beside A's map. Hover or tap a card and the map flies to its pin; tap a pin and its card is highlighted. On a phone the two stack, with the map on top. The most Pinterest-like, and the most work.
- **D — A commercial map (Google Maps / Mapbox)**: prettier maps, but needs an account and an API key, often billing, and their large script running in a page that holds your OpenRouter key.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**C — Board + map together.** *Rationale*:
- It's what "Pinterest-style pins **on a map**" describes: cards *and* a map.
- Building B first and adding A is the natural order anyway, so C costs little more than A.
- Copying Leaflet into `site/` keeps `script-src 'self'` intact (ADR-0002's key-protection rule). The only loosening is *images* from one tile server, and images can't run code.
- OSM's tile policy (https://operations.osmfoundation.org/policies/tiles/, read 2026-11-19) fits a personal site: visible credit, browsers' normal `Referer` (the page's `strict-origin-when-cross-origin` sends the site's origin, which the policy accepts), no prefetching, no offline use.
- D brings a big third-party script into the page that holds your key.

*Confidence*: 0.7 — because the security reasoning is solid, but how it looks on your phone is a taste call I can't make for you. *If wrong*: if the map turns out to matter little in use (you mostly scroll cards), fall back to B and drop the tile server from the security policy; if OSM ever blocks or throttles us, switch tiles to another OSM-based provider (the policy itself points to them).

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-PIN-PHOTOS: Do pins carry photos?
- Status: unanswered
- Why asking: Pinterest is mostly pictures. But your memory server stores text in a free database (Neon) and has no place to keep image files, and photos pulled from other websites load from those websites, which then see your visits.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — No photos for now**: pins are text cards (place, reason, date). Simplest; nothing new stored or loaded.
- **B — A photo link**: a favorite can carry an optional image address you paste (e.g. a photo you already posted somewhere). The card shows it. The page's security policy must then allow images from any `https:` site, and each of those sites sees when you view your board.
- **C — Upload your own photos**: you attach a photo when saving, and it's stored with the favorite. That needs real file storage, either a separate image service (another account and another key) or small thumbnails squeezed into the free database. Both are a project of their own.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**A — No photos for now.** *Rationale*: the map and coordinates (QST-GEO-COORDS, QST-MAP-STYLE) are the professor's core idea, and photos are an add-on with real costs. B weakens the security policy for every image on the internet, and C needs storage the project doesn't have (roadtrip-memory runs on Neon's free tier, ADR-0001 there). A text card can still *look* Pinterest-like: a colored tile per region, the reason as the caption. *Confidence*: 0.65 — because "Pinterest-style" may mean photos to you, which is exactly what this question is for. *If wrong*: if photos are the point for you, choose C, and we'll write a separate ADR on where images live; B is the quick middle path if you mostly have photos online already.

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

### QST-LOCATION-SHARE: When you tap 📍, what may leave your device?
- Status: unanswered
- Why asking: you asked that location be private. The fixed rules above already guarantee tap-only, never stored, and "near" measured in your browser. What's left: does the **model** get to know anything about where you are? It runs at a provider reached through OpenRouter, outside your device. Telling the model more makes the answers more helpful and the location less private.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Nothing leaves**: the page finds your favorites within, say, 50 km and tells the model only "favorites near Tiger right now: Big Sur (12 km), Nepenthe (15 km)". No coordinates, no town name. The model can plan around your favorites, but it can't suggest *new* places nearby, because it doesn't know where "nearby" is. If none are close, it's told only "no favorites within 50 km".
- **B — Rough area only**: A, plus your position **rounded to about 10 km** (one decimal place, e.g. 36.3, -121.9), so the model can also suggest new spots in your area. OpenRouter and the model provider see that rough area for that one message, and it is never stored.
- **C — Exact location**: your precise coordinates go to the model for that message. Best for "the closest gas station" kinds of questions; the provider sees exactly where you are.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-19)

**A — Nothing leaves.** *Rationale*:
- It matches "treat my location as private" literally, and it still delivers the professor's goal: the AI *knows what you like around you*, because it gets your nearby favorites.
- B and C send location to two outside parties: OpenRouter, and whichever provider runs the model (ADR-0002's trust map). Rounding helps, but a ~10 km area plus a timestamp is still personal.
- Because "near" is computed on your device, even the memory server never learns where you are.

*Confidence*: 0.7 — because privacy-vs-helpfulness is your trade to make; A is the safe default and easy to loosen later, while B and C can't be "un-shared". *If wrong*: if in real use you keep wanting "what *new* is near me?", move to B, still tap-only and never stored, with the rounding done before anything leaves the page.

**ANS:** (by Tiger Liu)
[Fill this in]   <!-- literal placeholder — parser-significant, do not paraphrase -->

---

## Supporting Materials

### DOC: policies read 2026-11-19
- Nominatim usage policy — https://operations.osmfoundation.org/policies/nominatim/ — max 1 req/s; identifying User-Agent/Referer; **no client-side autocomplete**; cache results; visible attribution; ODbL data.
- OSM tile usage policy — https://operations.osmfoundation.org/policies/tiles/ — visible attribution; valid Referer, no restrictive Referrer-Policy; no bulk/prefetch/offline; best-effort, may block heavy users.

### FIL: what changes where (if all recommendations are accepted)
- `~/roadtrip-memory/server.py` — `lat`/`lon` columns (nullable, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`); `save_favorite(place, reason, lat=None, lon=None)`; `list_favorites` returns coordinates; new read-only `find_place(name)` (Nominatim, 1 req/s, own User-Agent); its ADR-0007.
- `site/` — Save card shows the matched place and region; "Map" view (card board + vendored Leaflet map, OSM credit); 📍 button (Geolocation on tap → nearby favorites computed locally → one-time note to the model); CSP `img-src` += `https://tile.openstreetmap.org`.
- `~/roadtrip-memory/.claude/skills/my-ways/SKILL.md` — proposed new line for Tiger: *"Before saving, look the place up with `find_place` and propose the match that fits; if several fit, ask me which."*

---

## Action Items

- [ ] Answer QST-GEO-COORDS, QST-MAP-STYLE, QST-PIN-PHOTOS, QST-LOCATION-SHARE; check the fixed rules say what you meant - Owner: Tiger Liu
- [ ] Decide whether to add the proposed line to my-ways - Owner: Tiger Liu
- [ ] Build per answers (server ADR-0007 + page), tests first for: distance math, "location never stored/exported", Save card shows matched place - Owner: Tether

---

## Iterations

### Iteration 1 (2026-11-19)
- Trigger: Tiger relayed three suggestions from their professor
- Contributors: Tether (Claude Opus 5.5)
- Changes: read the Nominatim and OSM tile policies; fixed rules written from Tiger's message; four questions minted in the professor's order (1 → GEO-COORDS, 2 → MAP-STYLE + PIN-PHOTOS, 3 → LOCATION-SHARE)
- Outcome: Draft

---

## Glossary (optional)

- **Coordinates / lat-lon**: two numbers that pin a spot on Earth (latitude north–south, longitude east–west).
- **Geocoding**: turning a place name into coordinates ("Big Sur" → 36.27, -121.81).
- **Map tiles**: the small square map images a web map is assembled from.
- **Geolocation API**: the browser feature that asks your device where it is — always behind the browser's own permission prompt.

---

## Links

- Related ADRs: ADR-0002 (key in localStorage → tight security policy), ADR-0004 (memory connection, Save card rule)
- Related code: `~/roadtrip-memory/server.py`, `site/tools.js`, `site/index.html` (CSP)
- Related elsewhere: roadtrip-memory ADR-0006 (lock + CORS); future roadtrip-memory ADR-0007 (coordinates + `find_place`)
