// Landmark photo for the welcome card (ADR-0007 QST-PHOTO-SOURCE = D):
// Tiger's own bundled photo first (photos.js); otherwise Wikipedia, asked ONLY
// when Tiger taps. Wikipedia then learns the city name, IP, time and browser,
// and that the request came from this site. It never gets coordinates.

const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Both hosts must be in the CSP img-src (index.html); anything else is refused.
const IMAGE_HOSTS = new Set(['thumb.wikimedia.org', 'upload.wikimedia.org']);

/** Article title: "Monterey, California" in the US (Wikipedia's convention), the bare name elsewhere. */
export function wikiTitle(city) {
  const state = city.country === 'US' && STATES[city.state];
  return state ? `${city.name}, ${state}` : city.name;
}

/** The single request: the article's free lead image, 800px wide. Only the title goes out. */
export function wikiRequestUrl(city) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1',
    prop: 'pageimages|pageprops', piprop: 'thumbnail|name', pithumbsize: '800',
    ppprop: 'disambiguation', titles: wikiTitle(city),
  });
  return `https://en.wikipedia.org/w/api.php?${p}`;
}

/** → { src, width, height, article, credit } or null (missing page, disambiguation, no free image). */
export function pickWikiImage(data) {
  const page = data && data.query && Array.isArray(data.query.pages) ? data.query.pages[0] : null;
  if (!page || page.missing || (page.pageprops && 'disambiguation' in page.pageprops)) return null;
  const t = page.thumbnail;
  if (!t || !t.source || !page.pageimage) return null;
  let url;
  try { url = new URL(t.source); } catch { return null; }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) return null;
  return {
    src: url.href,
    width: t.width,
    height: t.height,
    article: page.title,
    credit: `https://en.wikipedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`,
  };
}

export async function fetchWikiPhoto(city, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(wikiRequestUrl(city), { referrerPolicy: 'no-referrer', credentials: 'omit' });
  if (!res.ok) throw new Error(`Wikipedia answered ${res.status}.`);
  return pickWikiImage(await res.json());
}
