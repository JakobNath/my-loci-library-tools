// Asking the sources about one ISBN (PLAN.md, "Book data"; SOURCES.md): the
// Library of Congress catalog, HathiTrust's records, Open Library's edition
// record and, with a key, Google Books' volume record. The answers are read by the app's core
// (core/marc.js, core/book-data.js). The Library of Congress catalog service
// has no encrypted connection and does not allow calls from web pages, which
// is why it is asked only here, on the laptop (HOW_IT_WORKS.md, "4.4b").
//
// Every request names the app (IDENTITY), as Open Library and Wikimedia ask.
// A source that refuses a request (429 "too many requests", or 403) is not
// asked again for the rest of the run: it is "resting", and the report says so.

import { fromLibraryOfCongress, fromHathiTrust } from '../core/marc.js';
import { fromOpenLibraryEdition, fromGoogleBooksVolume, mergeFound } from '../core/book-data.js';
import { googleBooksItem } from '../core/lookup.js';

const TIMEOUT = 15000; // milliseconds; the catalog service is sometimes slow

/** How the laptop tools name themselves to the sources: the app, and where to find it. */
export const IDENTITY = 'MyLociLibraryTools/1 (+https://github.com/JakobNath/my-loci-library-tools)';

/** The addresses asked, in one place, so a source that moves is changed here only (SOURCES.md). */
export const ADDRESSES = {
  libraryOfCongress: 'http://lx2.loc.gov:210/lcdb',
  hathiTrust: 'https://catalog.hathitrust.org/api/volumes/full',
  openLibrary: 'https://openlibrary.org',
  googleBooks: 'https://www.googleapis.com/books/v1',
};

/** The Library of Congress catalog's answer for one ISBN (SRU, MARC XML). */
export const catalogUrl = isbn => `${ADDRESSES.libraryOfCongress}?version=1.1&operation=searchRetrieve&query=bath.isbn=${isbn}&maximumRecords=3&recordSchema=marcxml`;
const hathiTrustUrl = isbn => `${ADDRESSES.hathiTrust}/isbn/${isbn}.json`;
const openLibraryUrl = isbn => `${ADDRESSES.openLibrary}/isbn/${isbn}.json`;
const googleSearchUrl = (isbn, key) => `${ADDRESSES.googleBooks}/volumes?q=isbn:${isbn}&key=${encodeURIComponent(key)}`;
const googleVolumeUrl = (id, key) => `${ADDRESSES.googleBooks}/volumes/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`;

/** An answer that means "stop asking for now": too many requests, or refused. */
export const isRefusal = status => status === 429 || status === 403;

// One answer as text; null when the source does not know the book (404).
async function getText(url, fetchFn, name) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT), headers: { 'User-Agent': IDENTITY } });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`${name} answered ${response.status}`);
    error.refused = isRefusal(response.status);
    throw error;
  }
  return response.text();
}

async function askGoogleBooks(isbn, key, fetchFn) {
  const search = JSON.parse(await getText(googleSearchUrl(isbn, key), fetchFn, 'Google Books'));
  const item = googleBooksItem(search, isbn);
  if (!item) return null;
  const volume = JSON.parse(await getText(googleVolumeUrl(item.id, key), fetchFn, 'Google Books'));
  return fromGoogleBooksVolume(volume, isbn);
}

// The Library of Congress and HathiTrust, asked by catalogue number for a book without an ISBN.
const catalogUrlByLccn = lccn => `${ADDRESSES.libraryOfCongress}?version=1.1&operation=searchRetrieve&query=bath.lccn=${lccn}&maximumRecords=3&recordSchema=marcxml`;
const hathiTrustUrlByNumber = ({ lccn, oclc }) => (lccn ? `${ADDRESSES.hathiTrust}/lccn/${lccn}.json` : `${ADDRESSES.hathiTrust}/oclc/${oclc}.json`);
const digits = text => String(text || '').replace(/D/g, '');

/**
 * Each source's own reading of one book, as [name, ask] pairs: ask() gives
 * the source's answer read into our fields (core/lookup.js, "Found"), or null.
 * A book is asked by its ISBN; a book without one, by its LCCN or OCLC number,
 * from the Library of Congress (LCCN only) and HathiTrust, the two that are
 * searched by those numbers. Each source's raw answer is kept in `raw`, by
 * source name, for the record of answers (loci-enrich.mjs).
 * Used by askSources and by the source check (check-sources.mjs).
 * @param {string|{ lccn?: string, oclc?: string }} isbn 13 digits, or catalogue numbers
 * @param {{ fetchFn: typeof fetch, googleBooksKey?: string, raw?: Record<string, string> }} options without a key, Google Books is left out
 * @returns {[string, () => Promise<object|null>][]}
 */
export function sourcesFor(isbn, { fetchFn, googleBooksKey = '', raw = {} }) {
  const keep = (name, answer) => { if (answer !== null) raw[name] = answer; return answer; };
  if (typeof isbn !== 'string') {
    const numbers = { lccn: digits(isbn.lccn), oclc: digits(isbn.oclc) };
    return [
      ...(numbers.lccn ? [['Library of Congress', async () => fromLibraryOfCongress(keep('Library of Congress', await getText(catalogUrlByLccn(numbers.lccn), fetchFn, 'The Library of Congress')), numbers)]] : []),
      ['HathiTrust', async () => {
        const text = keep('HathiTrust', await getText(hathiTrustUrlByNumber(numbers), fetchFn, 'HathiTrust'));
        return text && fromHathiTrust(text, numbers);
      }],
    ];
  }
  return [
    ['Library of Congress', async () => fromLibraryOfCongress(keep('Library of Congress', await getText(catalogUrl(isbn), fetchFn, 'The Library of Congress')), isbn)],
    ['HathiTrust', async () => {
      const text = keep('HathiTrust', await getText(hathiTrustUrl(isbn), fetchFn, 'HathiTrust'));
      return text && fromHathiTrust(text, isbn);
    }],
    ['Open Library', async () => {
      const text = keep('Open Library', await getText(openLibraryUrl(isbn), fetchFn, 'Open Library'));
      return text && fromOpenLibraryEdition(JSON.parse(text), isbn);
    }],
    // Google's answers are read but not kept: Google's terms ask that its results not be stored apart from showing them (SOURCES.md).
    ...(googleBooksKey ? [['Google Books', () => askGoogleBooks(isbn, googleBooksKey, fetchFn)]] : []),
  ];
}

/**
 * Ask every source about one book, at the same moment (they are different
 * services), and merge their answers, the Library of Congress first. A
 * source that fails is reported and left out; the others still count. A
 * source that refuses is added to `resting` and not asked again while it is
 * there (the caller keeps one `resting` set for a whole run).
 * @param {string|{ lccn?: string, oclc?: string }} isbn 13 digits, or catalogue numbers for a book without an ISBN
 * @param {{ fetchFn: typeof fetch, googleBooksKey?: string, resting?: Set<string> }} options
 * @returns {Promise<{ found: object|null, sources: string[], problems: string[], answers: { name: string, found: object|null }[], raw: Record<string, string> }>}
 *   answers: each source's own reading, best first; raw: the answers as the sources sent them (not Google's)
 */
export async function askSources(isbn, { fetchFn, googleBooksKey = '', resting = new Set() }) {
  const raw = {};
  const asking = sourcesFor(isbn, { fetchFn, googleBooksKey, raw }).filter(([name]) => !resting.has(name));
  const problems = [];
  const readings = await Promise.all(asking.map(([name, ask]) => ask().catch(error => {
    if (error.refused) resting.add(name);
    problems.push(`${name}: ${error.message}${error.refused ? ' (not asked again this run)' : ''}`);
    return null;
  })));
  return {
    found: mergeFound(readings),
    sources: asking.filter((source, i) => readings[i]).map(([name]) => name),
    problems,
    answers: asking.map(([name], i) => ({ name, found: readings[i] })),
    raw,
  };
}
