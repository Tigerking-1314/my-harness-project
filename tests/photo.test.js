// Tests for site/photo.js — the one request that may leave the device for the
// welcome card: a Wikipedia photo of your city, made only when you tap (ADR-0007
// QST-PHOTO-SOURCE = D). Fixtures are real API answers captured 2026-11-24.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wikiTitle, wikiRequestUrl, pickWikiImage, fetchWikiPhoto } from '../site/photo.js';

const MONTEREY = { name: 'Monterey', country: 'US', state: 'CA', lat: 36.6, lon: -121.895 };
const PARIS = { name: 'Paris', country: 'FR', state: '', lat: 48.853, lon: 2.349 };

const MONTEREY_ANSWER = {
  batchcomplete: true,
  query: { pages: [{
    pageid: 40444, ns: 0, title: 'Monterey, California',
    thumbnail: {
      source: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b7/Santa_Catalina_School%2C_Monterey%2C_CA_%28cropped%29.jpg/960px-Santa_Catalina_School%2C_Monterey%2C_CA_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail',
      width: 800, height: 533,
    },
    pageimage: 'Santa_Catalina_School,_Monterey,_CA_(cropped).jpg',
  }] },
};
const SPRINGFIELD_ANSWER = { batchcomplete: true, query: { pages: [{ pageid: 57850, ns: 0, title: 'Springfield', pageprops: { disambiguation: '' } }] } };
const MISSING_ANSWER = { batchcomplete: true, query: { pages: [{ ns: 0, title: 'Nowhereville Zzq', missing: true }] } };

describe('what Wikipedia is asked', () => {
  test('a US town is looked up with its state spelled out, because a bare "Monterey" is a disambiguation page', () => {
    assert.equal(wikiTitle(MONTEREY), 'Monterey, California');
    assert.equal(wikiTitle(PARIS), 'Paris');
  });

  test('the request names the city and nothing else: no coordinates, not even rounded', () => {
    const url = new URL(wikiRequestUrl(MONTEREY));
    assert.equal(url.origin, 'https://en.wikipedia.org'); // must match the CSP connect-src
    assert.equal(url.searchParams.get('titles'), 'Monterey, California');
    for (const n of ['36.6', '-121.8', '121.9', '36,6']) {
      assert.equal(url.href.includes(n), false, `leaked ${n}`);
    }
  });
});

describe('reading the answer', () => {
  test('a city article with a free lead image gives a photo and a credit link to its file page', () => {
    const photo = pickWikiImage(MONTEREY_ANSWER);
    assert.equal(new URL(photo.src).hostname, 'thumb.wikimedia.org'); // must match the CSP img-src
    assert.equal(photo.article, 'Monterey, California');
    assert.match(photo.credit, /^https:\/\/en\.wikipedia\.org\/wiki\/File:Santa_Catalina_School/);
  });

  test('an ambiguous name (Springfield) or an unknown town gives no photo instead of a wrong one', () => {
    assert.equal(pickWikiImage(SPRINGFIELD_ANSWER), null);
    assert.equal(pickWikiImage(MISSING_ANSWER), null);
  });

  test('the request goes out without a Referer or cookies', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = init;
      return { ok: true, json: async () => MONTEREY_ANSWER };
    };
    const photo = await fetchWikiPhoto(MONTEREY, fetchImpl);
    assert.equal(photo.article, 'Monterey, California');
    assert.equal(seen.referrerPolicy, 'no-referrer');
    assert.equal(seen.credentials, 'omit');
  });
});
