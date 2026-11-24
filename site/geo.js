// Location math that never leaves the browser.
// - ADR-0005: favorites near you, and the note the model gets (no coordinates, no distances).
// - ADR-0007: the nearest city from the bundled list (cities.js), for the header.

const EARTH_KM = 6371;
export const NEAR_KM = 50;   // "near me" radius for favorites (ADR-0005 QST-LOCATION-SHARE)
const IN_CITY_KM = 10;       // closer than this, you're "in" the city rather than "near" it

// ---------- favorites (format contract: roadtrip-memory list_favorites) ----------

const LINE_RE = /^#(\d+) \(([^)]*)\): (.+)$/;
const COORDS_RE = /\s*\[(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\]\s*$/;

/** "#3 (date): Big Sur — Beautiful coast [36.27, -121.81]" lines → favorites. */
export function parseFavorites(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    let rest = m[3];
    let lat = null;
    let lon = null;
    const c = COORDS_RE.exec(rest);
    if (c) {
      lat = Number(c[1]);
      lon = Number(c[2]);
      rest = rest.slice(0, c.index);
    }
    const cut = rest.indexOf(' — '); // the first dash separates place from reason
    const place = (cut === -1 ? rest : rest.slice(0, cut)).trim();
    const reason = cut === -1 ? '' : rest.slice(cut + 3).trim();
    out.push({ id: Number(m[1]), date: m[2], place, reason, lat, lon });
  }
  return out;
}

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Favorites with a position within `maxKm` of `here`, nearest first, each with `km`. */
export function nearbyFavorites(favorites, here, maxKm = NEAR_KM) {
  return favorites
    .filter((f) => f.lat != null && f.lon != null)
    .map((f) => ({ ...f, km: distanceKm(here, f) }))
    .filter((f) => f.km <= maxKm)
    .sort((a, b) => a.km - b.km);
}

export function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km)} km`;
}

/** The one-time note for the model: which favorites are near, never where Tiger is or how far. */
export function locationNote(near) {
  const privacy = "Tiger's location is private: it is not shared with you, so don't guess or state where Tiger is or how far away anything is.";
  if (!near.length) return `None of Tiger's saved favorites are within ${NEAR_KM} km of where Tiger is right now. ${privacy}`;
  const list = near.map((f) => (f.reason ? `${f.place} (${f.reason})` : f.place)).join('; ');
  return `Tiger's saved favorites near where Tiger is right now, nearest first: ${list}. ${privacy}`;
}

// ---------- nearest city (ADR-0007) ----------

/** cities.js rows "name|country|US state|lat|lon" → [{ name, country, state, lat, lon }]. */
export function parseCities(text) {
  const out = [];
  for (const row of String(text || '').split('\n')) {
    const [name, country, state, lat, lon] = row.split('|');
    if (!name || lat === undefined || lon === undefined) continue;
    out.push({ name, country, state: state || '', lat: Number(lat), lon: Number(lon) });
  }
  return out;
}

/** → { city, km } for the closest city, or null for an empty list. A plain scan: ~50k rows, a few ms. */
export function nearestCity(cities, here) {
  let best = null;
  let bestKm = Infinity;
  for (const c of cities) {
    const km = distanceKm(here, c);
    if (km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best ? { city: best, km: bestKm } : null;
}

let regionNames = null;
function countryName(code) {
  try {
    regionNames = regionNames || new Intl.DisplayNames(['en'], { type: 'region' });
    return regionNames.of(code) || code;
  } catch {
    return code;
  }
}

/** "Monterey, CA" in the US; "Toronto, Canada" elsewhere (a bare "CA" would read as California). */
export function cityLabel(city) {
  if (city.country === 'US') return city.state ? `${city.name}, ${city.state}` : city.name;
  return `${city.name}, ${countryName(city.country)}`;
}

/** Header wording: "Monterey, CA", or "near Peach Springs, AZ · 55 km" when the town is further off. */
export function describePlace(hit) {
  const label = cityLabel(hit.city);
  return hit.km <= IN_CITY_KM ? label : `near ${label} · ${formatDistance(hit.km)}`;
}
