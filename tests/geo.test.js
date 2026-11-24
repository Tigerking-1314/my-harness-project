// Tests for site/geo.js — "near me" without giving away where "me" is (ADR-0005),
// and "which city am I in?" answered on the device from a bundled list (ADR-0007).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFavorites, distanceKm, nearbyFavorites, locationNote, formatDistance,
  parseCities, nearestCity, describePlace,
} from '../site/geo.js';

// Real rows from GeoNames (cities1000 for the US, cities15000 elsewhere), in the
// format scripts/build-cities.py writes to site/cities.js: name|country|US state|lat|lon.
// Three Montereys on purpose: the name alone is ambiguous, the nearest one must win.
const CITY_ROWS = [
  'Monterey|US|TN|36.148|-85.268',
  'Monterey|US|VA|38.412|-79.581',
  'Monterey|US|CA|36.600|-121.895',
  'Carmel Valley Village|US|CA|36.506|-121.766',
  'Kingman|US|AZ|35.189|-114.053',
  'Peach Springs|US|AZ|35.529|-113.425',
  'Prescott Valley|US|AZ|34.610|-112.316',
  'Toronto|CA||43.653|-79.384',
  'Paris|FR||48.853|2.349',
].join('\n');

describe('which city am I in (ADR-0007)', () => {
  const cities = parseCities(CITY_ROWS);

  test('standing in downtown Monterey, CA names Monterey, CA, not its namesakes in TN or VA', () => {
    const hit = nearestCity(cities, { lat: 36.6002, lon: -121.8947 });
    assert.equal(describePlace(hit), 'Monterey, CA');
  });

  test('out on the road the page says how far the nearest town is, instead of claiming you are in it', () => {
    // Seligman, AZ on Route 66 (pop. ~450) is in no list; measured 2026-11-24: Peach Springs, 55 km.
    const hit = nearestCity(cities, { lat: 35.326, lon: -112.877 });
    assert.equal(hit.city.name, 'Peach Springs');
    assert.equal(describePlace(hit), 'near Peach Springs, AZ · 55 km');
  });

  test('outside the US the country is spelled out, so Toronto is not read as Toronto, California', () => {
    const hit = nearestCity(cities, { lat: 43.65, lon: -79.38 });
    assert.equal(describePlace(hit), 'Toronto, Canada');
  });

  test('an empty list finds nothing rather than crashing', () => {
    assert.equal(nearestCity([], { lat: 0, lon: 0 }), null);
  });

  test('the shipped list (site/cities.js) parses and answers like the 2026-11-24 measurements', async () => {
    // Guards the format contract between scripts/build-cities.py and parseCities():
    // a regenerated file in a different shape would otherwise only show up as "no city".
    // Paris: caught on first run (2026-11-24): GeoNames lists city sections (PPLX), and
    // central Paris came out as "Paris 04 Hôtel-de-Ville"; build-cities.py now drops them.
    const { CITIES } = await import('../site/cities.js');
    const shipped = parseCities(CITIES);
    assert.ok(shipped.length > 40000, `only ${shipped.length} places`);
    assert.equal(describePlace(nearestCity(shipped, { lat: 36.27, lon: -121.808 })), 'near Carmel Valley Village, CA · 27 km'); // Big Sur
    assert.equal(describePlace(nearestCity(shipped, { lat: 48.8566, lon: 2.3522 })), 'Paris, France');
  });
});

// Same sample lines as roadtrip-memory tests/test_geo.py (the format contract).
const LIST = [
  '#1 (2026-11-19 10:00): Blue Moon Diner — Best pie on Route 66',
  '#3 (2026-11-19 10:00): Big Sur — Beautiful coast [36.27047, -121.80806]',
  '#4 (2026-11-19 11:30): Nepenthe — View — and the burger [36.22168, -121.75983]',
  '#5 (2026-11-19 12:00): Zion National Park — Liked the hiking [37.29816, -113.02637]',
].join('\n');

describe('reading the memory', () => {
  test('favorites with and without a map position are both read', () => {
    const favs = parseFavorites(LIST);
    assert.equal(favs.length, 4);
    assert.deepEqual(favs[0], { id: 1, date: '2026-11-19 10:00', place: 'Blue Moon Diner', reason: 'Best pie on Route 66', lat: null, lon: null });
    assert.deepEqual([favs[1].lat, favs[1].lon], [36.27047, -121.80806]);
  });

  test('a dash inside the reason does not break the line apart', () => {
    const nepenthe = parseFavorites(LIST)[2];
    assert.equal(nepenthe.place, 'Nepenthe');
    assert.equal(nepenthe.reason, 'View — and the burger');
  });

  test('the empty-memory message yields no favorites', () => {
    assert.deepEqual(parseFavorites('No favorites yet. Save a place worth stopping again.'), []);
  });
});

describe('distance', () => {
  test('San Francisco to Los Angeles is about 559 km', () => {
    const km = distanceKm({ lat: 37.7749, lon: -122.4194 }, { lat: 34.0522, lon: -118.2437 });
    assert.ok(Math.abs(km - 559) < 3, `got ${km}`);
  });

  test('from Monterey, Big Sur and Nepenthe are near, Zion and the diner (no position) are not', () => {
    const monterey = { lat: 36.6002, lon: -121.8947 };
    const near = nearbyFavorites(parseFavorites(LIST), monterey);
    assert.deepEqual(near.map((f) => f.place), ['Big Sur', 'Nepenthe']);
    assert.ok(near[0].km < near[1].km);
  });

  test('distances read naturally on the cards', () => {
    assert.equal(formatDistance(0.42), '420 m');
    assert.equal(formatDistance(37.6), '38 km');
  });
});

describe('what the model is told (QST-LOCATION-SHARE = A)', () => {
  const here = { lat: 36.6002, lon: -121.8947 };
  const near = nearbyFavorites(parseFavorites(LIST), here);
  const note = locationNote(near);

  test('it names the nearby favorites, nearest first', () => {
    assert.ok(note.indexOf('Big Sur') < note.indexOf('Nepenthe'));
    assert.match(note, /Beautiful coast/);
  });

  test('it contains no coordinates — not Tiger’s, not even rounded', () => {
    for (const n of [here.lat, here.lon, 36.6, -121.9, 36.60, -121.89]) {
      assert.equal(note.includes(String(n)), false, `leaked ${n}`);
    }
  });

  test('it contains no distances, which could be used to triangulate Tiger', () => {
    // Big Sur's and Nepenthe's coordinates are visible to the model via list_favorites;
    // two exact distances to known points would pin Tiger down to a spot.
    for (const f of near) {
      assert.equal(note.includes(formatDistance(f.km)), false);
      assert.equal(note.includes(String(Math.round(f.km))), false);
    }
  });

  test('with nothing nearby, the model is told so — still without a position', () => {
    const empty = locationNote([]);
    assert.match(empty, /None of Tiger's saved favorites are within 50 km/);
    assert.match(empty, /private/);
  });
});
