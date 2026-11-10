// Asking the three sources about one ISBN (PLAN.md, "Book data"): the
// Library of Congress catalog, Open Library's edition record and, with a key,
// Google Books' volume record. The answers are read by the app's core
// (core/marc.js, core/book-data.js). The Library of Congress catalog service
// has no encrypted connection and does not allow calls from web pages, which
// is why it is asked only here, on the laptop (HOW_IT_WORKS.md, "4.4b").

import { fromLibraryOfCongress } from '../core/marc.js';
import { fromOpenLibraryEdition, fromGoogleBooksVolume, mergeFound } from '../core/book-data.js';
import { googleBooksItem } from '../core/lookup.js';

const TIMEOUT = 15000; // milliseconds; the catalog service is sometimes slow

/** The Library of Congress catalog's answer for one ISBN (SRU, MARC XML). */
export const catalogUrl = isbn => `http://lx2.loc.gov:210/lcdb?version=1.1&operation=searchRetrieve&query=bath.isbn=${isbn}&maximumRecords=3&recordSchema=marcxml`;
const openLibraryUrl = isbn => `https://openlibrary.org/isbn/${isbn}.json`;
const googleSearchUrl = (isbn, key) => `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${encodeURIComponent(key)}`;
const googleVolumeUrl = (id, key) => `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`;

// One answer as text; null when the source does not know the book (404).
async function getText(url, fetchFn, name) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${name} answered ${response.status}`);
  return response.text();
}

async function askGoogleBooks(isbn, key, fetchFn) {
  const search = JSON.parse(await getText(googleSearchUrl(isbn, key), fetchFn, 'Google Books'));
  const item = googleBooksItem(search, isbn);
  if (!item) return null;
  const volume = JSON.parse(await getText(googleVolumeUrl(item.id, key), fetchFn, 'Google Books'));
  return fromGoogleBooksVolume(volume, isbn);
}

/**
 * Ask every source about one ISBN, at the same moment (they are three
 * different services), and merge their answers, the Library of Congress first.
 * A source that fails is reported and left out; the others still count.
 * @param {string} isbn 13 digits
 * @param {{ fetchFn: typeof fetch, googleBooksKey?: string }} options without a key, Google Books is not asked
 * @returns {Promise<{ found: object|null, sources: string[], problems: string[] }>}
 */
export async function askSources(isbn, { fetchFn, googleBooksKey = '' }) {
  const asking = [
    ['Library of Congress', async () => fromLibraryOfCongress(await getText(catalogUrl(isbn), fetchFn, 'The Library of Congress'), isbn)],
    ['Open Library', async () => {
      const text = await getText(openLibraryUrl(isbn), fetchFn, 'Open Library');
      return text && fromOpenLibraryEdition(JSON.parse(text), isbn);
    }],
    ...(googleBooksKey ? [['Google Books', () => askGoogleBooks(isbn, googleBooksKey, fetchFn)]] : []),
  ];
  const problems = [];
  const answers = await Promise.all(asking.map(([name, ask]) => ask().catch(error => {
    problems.push(`${name}: ${error.message}`);
    return null;
  })));
  return {
    found: mergeFound(answers),
    sources: asking.filter((source, i) => answers[i]).map(([name]) => name),
    problems,
  };
}
