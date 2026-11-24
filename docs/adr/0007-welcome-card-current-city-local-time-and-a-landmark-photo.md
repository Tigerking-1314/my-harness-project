<!-- adr template version: "adr 3.12.0" -->
<!--
adr teaching map: the example is not the teaching — these are the up-links from this file to what teaches its form; load them rather than winging it. (Sibling: the template-version marker dates the mold this file was minted from.)
  skill: adr-authoring
  mcp: adrs4ai
  plugin: adr@adrs4ai
-->

# Welcome card: current city, local time, and a landmark photo

- **Date**: 2026-11-24
- **Iteration**: 4
- **Status**: Implemented
- **Deciders**: Tiger Liu, Tether (Claude Opus 5.5)

**TL;DR**: When the page opens, show your current city (worked out on your device from a bundled city list), the time from your device clock, and a landmark photo for that city. Your coordinates never leave the device. Three questions decide when location is read, how detailed the city list is, and where photos come from.

---

## Originating Context

**Source**: `Human dump (below)` — Tiger's message, 2026-11-24. Builds on ADR-0005 (private location) and ADR-0006 (the desert-sunset look).

> New idea: when I open the page, show my current city name, local time, and a famous landmark photo for that city. Time from the device clock. City: use browser geolocation only after I allow it, and find the nearest city from a bundled offline city list, so my coordinates never leave the device. Landmark photo: give me options as a QST (Wikipedia/Wikimedia image by city name vs. my own bundled photos vs. both), including what each changes in the CSP and what Wikipedia would learn. Add this to ADR-0005's location work or a new ADR, then build after I answer.

**Agency Grant**: Choose ADR-0005 or a new ADR; write the photo question with its CSP and privacy effects; build only after Tiger answers.

**Where this lives**: a new ADR. ADR-0005 is Accepted and about favorites on a map. This is a different feature with its own questions. It inherits ADR-0005's location rules, and the one place it needs to bend them is asked below (QST-LOCATE-WHEN), not done quietly.

---

## Explicitation

**What I understand**:

1. **Time**: the device clock in the device's time zone (`Intl.DateTimeFormat`), refreshed every minute. It needs no permission and sends nothing anywhere.
2. **City**: the browser's Geolocation API, behind the browser's own "Allow location?" prompt. The coordinates are compared against a city list that ships with the site, and the nearest city wins, all in your browser. → QST-LOCATE-WHEN (when it's read) and QST-CITY-LIST (how detailed the list is).
3. **Photo**: the only part that might need the network. Fetching anything "for Monterey" tells whoever serves it that you're looking at Monterey, so the photo source is the real privacy decision. → QST-PHOTO-SOURCE

**Fixed rules** (your message plus ADR-0005, not up for a vote):

- **Coordinates never leave the device.** The city is found locally. The memory server, OpenRouter and the model never get coordinates.
- **Location is never stored.** The city and coordinates are not saved in localStorage, the conversation, exports or the memory server. They exist only while the page is open. One consequence: a Wikipedia photo can't be "remembered per city" in localStorage, because that list would be a record of where you've been.
- **The city is never sent to the model.** It's shown on your screen only. ADR-0005 QST-LOCATION-SHARE A stands: the model hears about nearby *favorites*, never a town.

**Technical notes** (checked 2026-11-24):

- **The CSP doesn't change for the city list.** `connect-src` has no `'self'`, so the page can't `fetch()` its own data file. The list ships as a JavaScript module and loads with `import()`, which `script-src 'self'` already allows. It loads only after location is granted, so a visit where you decline costs nothing, and after that it comes from the browser's cache.
- **City data source**: GeoNames city lists (CC BY 4.0). The page shows a "City data © GeoNames" credit.
- **Wikipedia's API works from the browser.** `https://en.wikipedia.org/api/rest_v1/page/summary/<title>` returns `access-control-allow-origin: *` and an `originalimage` URL on `upload.wikimedia.org`. **But the lead image isn't always a landmark.** For `Monterey,_California` it is currently a photo of *Santa Catalina School*, not Cannery Row or Bixby Bridge (checked 2026-11-24).
- **Distance from the city.** The nearest listed city can be far away on a road trip, so the card says "near Monterey · 38 km" when you're more than ~10 km from the city centre, rather than claiming you're *in* it.

**Doubt (Secondary Directive) — the untracked `tests/geo.test.js`**: It dates from 2026-11-19 and is Tether's tests-first start on ADR-0005's build. The `site/geo.js` it imports was never written, so `just gate` is red in the worktree. The nearest-city search needs the same great-circle distance that file already specifies (`distanceKm`). Plan: write `site/geo.js` to pass those existing tests (pure functions only, no map UI), add `nearestCity` beside it, and commit both. That makes the gate green again and moves ADR-0005's build forward by its pure-function layer. Say so if you'd rather keep ADR-0005's code separate.

**Assumption — where it shows**: the city and clock sit in the header sky (top right, always visible). The photo is the welcome card in an empty chat, above "Where to next?", replacing the road drawing when there's a photo. Without a city or a photo, the road drawing from ADR-0006 stays. Say if you want it elsewhere.

**Confirm**: Tiger — the three questions below, and whether the fixed rules say what you meant.

---

## Questions

### QST-LOCATE-WHEN: When does the page read your location?
- Status: answered
- Why asking: ADR-0005 has a fixed rule: location is read "only when you tap a 📍 button… never in the background". You've now asked for the city to appear when the page opens. Once you've allowed location, the browser remembers that and stops asking, so "on open" means the page reads your location every time you open it, with no tap. Nothing leaves the device for the city itself, but it does relax ADR-0005's rule, so it's your call.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Tap once, then automatic**: The first time, the header shows a "📍 Show my city" button. Tapping it brings up the browser's "Allow location?" prompt. After you allow it, the page checks the browser's remembered permission and reads your location on every open, with no tap. You turn it off in the browser's site settings. ADR-0005's rule gets one written exception: the on-screen city may be read automatically, because it never leaves the device and is never stored. The 📍 button for telling the *model* about nearby favorites stays tap-only.
- **B — Tap every time**: Each time the page opens, the header shows "📍 Show my city". Nothing is read until you tap, which follows ADR-0005's rule word for word. The cost is one tap every visit, and the city is never just *there* when you open the page.
- **C — A switch in Settings**: "Show my city when the page opens", off by default. When it's on, the page behaves like A. The switch itself is saved (it's a preference, not a location). Choose this to turn the feature off in the page without digging through browser settings.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-24)

**A — Tap once, then automatic.** *Rationale*: A is what you asked for: the city is there "when I open the page", "only after I allow it". The browser's permission is exactly that allow, and asking for it only after a tap avoids a prompt the moment the page loads, which browsers discourage. The exception it makes to ADR-0005 is narrow: what ADR-0005 protects against is location *leaving* or being *kept*, and A does neither. B honours the old rule at the cost of the feature. C adds a second off switch that duplicates the browser's. *Confidence*: 0.7 — because the privacy reasoning holds, but "never in the background" may matter to you as a principle, not just for its effects. *If wrong*: if reading location without a tap feels wrong even though nothing leaves the device, choose **B**. If you want an in-page off switch, choose **C**.

**ANS:** (by Tiger Liu, 2026-11-24)
C — A switch in Settings, "Show my city when the page opens", off by default.

---

### QST-CITY-LIST: How detailed should the bundled city list be?
- Status: answered
- Why asking: The list decides which "nearest city" you see. Small towns make it more accurate on back roads, but the file gets bigger. It downloads once, only after you allow location, then comes from the browser cache. Your trips so far are in the US (Big Sur, Zion, Route 66), but the page itself isn't US-only. Measured 2026-11-24 from GeoNames files, with each place stored as name, region and coordinates:
- Need: pick a letter (or override — any shape answers)

Options:
- **A — World cities over 15,000 people**: 34,244 places, about 950 KB (about 425 KB to download, compressed). Big Sur → "near Monterey · 38 km". Zion → "near Hurricane · 27 km". Seligman on Route 66 → "near Prescott Valley · 95 km". Death Valley → "near Pahrump · 84 km".
- **B — US towns over 1,000 people, US only**: 17,348 places, about 195 KB compressed. Big Sur → "near Carmel Valley Village · 27 km". Zion → "near Toquerville · 23 km". Seligman → "near Peach Springs · 55 km". Death Valley → "Death Valley · 25 km". Outside the US it shows no city, just the time.
- **C — US towns over 1,000 plus world cities over 15,000**: 48,181 places, about 580 KB compressed. B's detail inside the US and A's coverage everywhere else.
- **D — World towns over 1,000 people**: 172,096 places, about 2 MB compressed. The most detail everywhere, but heavy for a phone on rural data.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-24)

**C — US towns plus world cities.** *Rationale*: The numbers above show A naming a city 84–95 km away at two of four real road-trip spots. B and C cut that to 25–55 km. C keeps working abroad for about 385 KB more than B, downloaded once and only after you allow location. D's 2 MB buys little on US roads beyond C. Even D misses Seligman (population ~450): the nearest town over 1,000 is still Peach Springs. *Confidence*: 0.65 — because the sizes and distances are measured, but how much you travel outside the US is your call. *If wrong*: if you only ever road-trip in the US, take **B** (smallest). If ~400 KB matters less to you than simplicity, **A** is the plain worldwide list.

**ANS:** (by Tiger Liu, 2026-11-24)
C — US towns over 1,000 plus world cities over 15,000.

---

### QST-PHOTO-SOURCE: Where does the landmark photo come from?
- Status: answered
- Why asking: The time and city never leave your device. The photo is the one part that may have to: any outside service asked for "a photo of Monterey" learns you're looking at Monterey. Each option below says what changes in the page's security policy (CSP, in `site/index.html`) and what Wikipedia would learn. The CSP matters because your OpenRouter key lives in this page's storage (ADR-0002). Images can't run code, so loosening `img-src` is lower-risk than anything touching scripts.
- Need: pick a letter (or override — any shape answers)

Options:
- **A — Wikipedia, automatic**: Each time the page finds your city, it asks Wikipedia for that city's article summary and shows its lead image, with a credit link to the photo's Commons page (author and licence are there).
  - *CSP*: `connect-src` adds `https://en.wikipedia.org`, and `img-src` adds `https://upload.wikimedia.org`. Scripts are untouched.
  - *What Wikipedia learns, each time you open the page*: the city name (it's in the request), your IP address, the time, your browser type, and that the request came from `tigerking-1314.github.io` (browsers always send the site's origin with this kind of request). Together that's a city-level log of where you were and when, kept on Wikimedia's servers under their privacy policy. Coordinates never go.
  - *Also*: it works for any city, but the "landmark" is whatever the article leads with: a school for Monterey today, sometimes a map or a skyline.
- **B — Your own bundled photos**: You add photos to the repo (`site/photos/`, plus a small list of city → photo and caption). A city with a photo shows it. Any other city shows the ADR-0006 road drawing.
  - *CSP*: unchanged.
  - *What Wikipedia learns*: nothing. Nothing leaves the device.
  - *Also*: it only covers cities you've prepared, and on a road trip you mostly reach new ones. The repo and site are public, so the photos (and which cities you picked) are public too, and they must be yours or freely licensed. About 200 KB per photo, resized.
- **C — Both, automatic**: Your bundled photo if there is one, otherwise Wikipedia, fetched automatically as in A.
  - *CSP*: as in A.
  - *What Wikipedia learns*: as in A, but only on opens in cities without a bundled photo, which on a road trip is most of them.
- **D — Both, Wikipedia only on tap**: Your bundled photo if there is one. Otherwise the road drawing plus a "Show a photo of Monterey" button, and Wikipedia is asked only when you tap it.
  - *CSP*: as in A.
  - *What Wikipedia learns*: as in A, but only at the moments you tap, so each lookup is a choice you make. Opening the page never contacts Wikipedia on its own.

**Recommendation**: (by Tether, Claude Opus 5.5, 2026-11-24)

**D — Both, Wikipedia only on tap.** *Rationale*: D keeps ADR-0005's principle that location-revealing requests happen only when you choose them (tap-only). That principle is the reason ADR-0005 never centres the map on you: tile requests would leak your area. It also still covers every city. A and C would send a city-level "where Tiger is right now" to Wikimedia on every open, automatically. That's the same kind of leak, and keeping your coordinates on the device was meant to prevent it. B is the purest option but would show the fallback drawing in most towns on a real trip. The CSP change in A, C and D is the same: two Wikimedia hosts, images and data only, no scripts. *Confidence*: 0.6 — because how much a city-level log at Wikimedia matters to you is a values call, and the lead-image quality (the Monterey school) may make Wikipedia feel not worth even a tap. *If wrong*: if a city-level log at Wikimedia doesn't bother you and you want the photo to just appear, choose **C**. If the Wikipedia images disappoint, choose **B** and keep the CSP unchanged.

**ANS:** (by Tiger Liu, 2026-11-24)
D — My bundled photo first; otherwise Wikipedia, only when I tap.

---

## Supporting Materials

### DOC: measurements (2026-11-24)
- GeoNames `cities15000` / `cities5000` / `cities1000` (https://download.geonames.org/export/dump/): 34,244 / 70,113 / 172,096 rows; US rows 3,411 / 7,561 / 17,348. "Compact" = `name|region|lat(3dp)|lon(3dp)` per line; gzip -9 sizes as quoted in QST-CITY-LIST.
- Nearest-city distances at Big Sur (36.270, -121.808), Zion (37.298, -113.026), Seligman (35.326, -112.877) and Death Valley (36.462, -116.866), haversine, as quoted in QST-CITY-LIST. Not stored in the repo. Computed in the session scratchpad from the downloaded GeoNames files.
- Wikipedia REST summary for `Monterey,_California`: HTTP 200, `access-control-allow-origin: *`, `originalimage` = `upload.wikimedia.org/…/Santa_Catalina_School,_Monterey,_CA_(cropped).jpg`.

### FIL: what changes where
- `site/geo.js` (new) — the pure functions the untracked `tests/geo.test.js` specifies, plus `nearestCity`; tests committed with it.
- `site/cities.js` (new, generated) — the chosen list as an ES module; a script under `scripts/` regenerates it from GeoNames.
- `site/app.js` — header city and clock, the welcome card, the location read (per QST-LOCATE-WHEN).
- `site/index.html` — the header slot; the CSP only if QST-PHOTO-SOURCE ≠ B.
- `site/photos/` + `site/photos.js` — if QST-PHOTO-SOURCE ∈ {B, C, D}.

---

## Decision

*Accepted 2026-11-24 (Tiger Liu): C Settings switch · C US towns + world cities · D bundled photo first, Wikipedia only on tap.*

**Build shape**:
- **Switch**: Settings → "Show my city when the page opens" (`settings.showCity`, default `false`). It's a preference, not a location: the switch is saved, the city never is. Turning it on reads location right away; that tap is what brings up the browser's prompt. While it's on, every open reads location once. While it's off, the header shows only the clock, and the page never calls the Geolocation API.
- **Amends ADR-0005's "tap-only" rule** for this one case: with the switch on, the on-screen city is read without a 📍 tap. It still never leaves the device and is never stored. The 📍 note to the *model* (ADR-0005) stays tap-only.
- **Header** (right side of the sky): the city ("near Monterey, CA · 38 km" past 10 km) over the device-clock time. Plus a small round photo when one is showing. **Changed from the iteration-1 assumption**: the page opens on your most recent conversation (`init()` in `site/app.js`), so a photo shown only in an empty chat would usually not be seen "when I open the page". The header thumbnail fixes that. ~~The empty chat shows the same photo large, in place of the road drawing.~~ *Replaced in iteration 4 (Tiger, 2026-11-24)*: the photo is now the **background of the whole chat area**, and tapping the header circle opens it large. See below.
- **Photo background** (iteration 4): behind the whole chat area (`#chat-bg`), the photo is blurred (14px), slightly desaturated and dimmed. Over it sits a translucent sand veil, or a desert-night veil (indigo fading to umber) in dark mode. To keep text readable, every message bubble has a solid background: user bubbles already did, and assistant replies now get a `--bubble` card. Small loose text over the photo (the model name, tool notes, errors, notices, the empty-state text) gets a solid chip or card too. Settings → "Photo background" (`settings.photoBackground`) is **on by default**. Turning it off removes the background; the header circle stays. Without a photo (switch off, no city, or 📷 not tapped yet), the page looks exactly as in ADR-0006.
- **Large view**: tapping the header circle opens a `<dialog>` with the photo, the place name ("Monterey, CA"), its source ("From Wikipedia: Monterey, California", or your own caption) and, for Wikipedia photos, the credit and licence link. It closes with ✕, Esc, or a tap outside it.
- **Photo**: `site/photos.js` maps a city label ("Monterey, CA") to a file under `site/photos/`. No match → a "📷 Photo" button. Tapping it makes one Wikipedia request (`en.wikipedia.org/w/api.php`, `prop=pageimages`, free images only, 800px), with no Referer and no cookies. The image loads with `referrerpolicy="no-referrer"`, and a credit link goes to its file page. Disambiguation pages and missing pages give "no photo", never a wrong one. The result is kept in memory for the open page only.
- **CSP**: `connect-src` + `https://en.wikipedia.org`; `img-src` + `https://thumb.wikimedia.org https://upload.wikimedia.org`. `script-src` is unchanged. **Correction to the question text**: the question named only `upload.wikimedia.org`, but the API's thumbnails actually come from `thumb.wikimedia.org` (checked 2026-11-24; it serves directly, without redirecting). Both are Wikimedia image hosts. `site/photo.js` refuses any other host.
- **City list**: `site/cities.js` (an ES module, loaded with `import()` only when the switch is on), generated by `scripts/build-cities.py` from GeoNames `cities1000` (US rows) + `cities15000` (other countries). It ends up at 45,293 places, ~540 KB compressed, slightly smaller than the 48,181 measured for the question because city sections and numbered districts are dropped (see Iteration 3). Labels are "Name, ST" in the US and "Name, Country" elsewhere, spelled out so "Toronto, CA" can't be misread as California. A GeoNames credit sits next to the switch.

---

## Action Items

- [x] Answer the three questions; check the fixed rules - Owner: Tiger Liu
- [x] Build, tests first (nearest city, "near X · N km" wording, the Wikipedia request carrying no coordinates) - Owner: Tether
- [ ] Add your own photos to `site/photos/` + `site/photos.js` (yours or freely licensed; instructions are at the top of `photos.js`) - Owner: Tiger Liu
- [ ] First real test: turn on "Show my city" on your phone and check that the browser prompt appears and the city is right - Owner: Tiger Liu

---

## Iterations

### Iteration 1 (2026-11-24)
- Trigger: Tiger's message (Originating Context)
- Contributors: Tiger Liu, Tether (Claude Opus 5.5)
- Changes: Measured the GeoNames list sizes and road-trip distances; checked Wikipedia's API (CORS, lead image); three questions with recommendations
- Outcome: Draft; the build waits on answers

### Iteration 2 (2026-11-24)
- Trigger: Tiger answered C, C, D
- Contributors: Tiger Liu, Tether (Claude Opus 5.5)
- Changes: Decision written. The photo moved into the header too, because the page opens on the last conversation. ADR-0005's tap-only rule amended for the on-screen city when the switch is on.
- Outcome: Draft → Accepted; build next

### Iteration 3 (2026-11-24)
- Trigger: build
- Contributors: Tether (Claude Opus 5.5)
- Changes:
  - New `site/geo.js` passes the Nov-19 ADR-0005 tests unchanged and adds `parseCities` / `nearestCity` / `cityLabel` / `describePlace`. New `site/photo.js` (Wikipedia). New `site/cities.js` + `scripts/build-cities.py`. New `site/photos.js` (empty, with instructions). Glue in `site/app.js`, plus `index.html` and `style.css`.
  - Tests: `tests/geo.test.js` (ADR-0005 tests + 5 new), `tests/photo.test.js` (6, built on real API answers). Gate: 81/81.
  - **Caught by the shipped-list test**: central Paris came out as "Paris 04 Hôtel-de-Ville". GeoNames tags arrondissements as ordinary towns (PPL), not as city sections (PPLX), so the first fix (dropping PPLX) didn't work. The generator now drops "<City> NN …" rows within 15 km of <City>, and drops PPLX as well. **Known limit**: districts named without a number (e.g. Vienna's "Leopoldstadt") can still win in a city centre. Those are real local names, so this is accepted.
  - Checked in headless Chrome over DevTools (`scripts/ephemeral/2026-11-24-cdp-welcome-card-screenshots.mjs`): faked Monterey position, light, dark and 390px phone, a real 📷 tap, no CSP violations, and nothing in localStorage mentions the city or coordinates. Screenshots led to moving the sun and moon off the city text and shortening the 📷 button on phones.
- Outcome: Accepted → Implemented; pushed to `main`

### Iteration 4 (2026-11-24)
- Trigger: Tiger: "Instead of a bigger circle, use the landmark photo as the chat area background… softly blurred and dimmed, with a translucent sand overlay (desert-night overlay in dark mode). Give message bubbles solid backgrounds… Keep the small circle in the header; tapping it opens the photo large with the place name and Wikipedia credit. Add a 'Photo background' switch in Settings, on by default. Check it on a phone, then push."
- Contributors: Tiger Liu, Tether (Claude Opus 5.5)
- Changes: Photo background + large view + switch (see Decision). The empty state is back to the ADR-0006 road drawing, now on a solid card when the photo is behind it. Assistant replies get a solid bubble everywhere, photo or not, so the page looks the same either way.
  - **Readability decision**: the veil alone isn't enough. Muted 12px text over a 72% sand veil on a dark patch of photo drops to roughly 3:1 contrast. So the rule is: **no text sits directly on the photo**. Everything gets a solid backing.
  - **Caught by the phone check, fixed**: in dark mode, inline `code` vanished inside the new reply bubble (`--code-bg` was almost exactly `--bubble`; now lighter), and on phones the moon sat behind the title (moved down toward the mesas).
  - **Behaviour to know**: the background appears only once there's a photo. For Wikipedia photos that means after you tap 📷, because nothing is fetched automatically (QST-PHOTO-SOURCE D still holds). Your bundled photos show as soon as the city is found.
  - Checked with `scripts/ephemeral/2026-11-24-cdp-photo-background-check.mjs`: a true 390×844 phone and desktop, light and dark, a seeded conversation with markdown and code, the large view, a new empty chat, and the switch turned off. Nothing in storage mentions the city or coordinates; no CSP errors. Gate: 81/81.
- Outcome: stays Implemented; pushed to `main`

---

## Links

- Related ADRs: ADR-0002 (why the CSP is strict), ADR-0005 (private-location rules; QST-LOCATION-SHARE A), ADR-0006 (header, road drawing fallback)
- Related code: `site/index.html` (CSP), `site/app.js`, `site/geo.js`, `site/photo.js`, `site/photos.js`, `site/cities.js`, `scripts/build-cities.py`, `tests/geo.test.js`, `tests/photo.test.js`
