// The source check (SOURCES.md, "Contract test"): asks each source live about
// the books whose answers are recorded for the tests (core/tests/answers/),
// reads both with the same code, and reports any source that no longer
// answers, refuses, or reads differently. A difference is not always a fault
// (a catalog record may have been improved), but it is the first thing to
// look at when lookups seem wrong, and a change in a source's answer is found
// here before it quietly fills wrong values. Part of the yearly check.
// Run: node check-sources.mjs   (or check-sources.cmd / check-sources.sh)

import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fromLibraryOfCongress } from '../core/marc.js';
import { fromOpenLibraryEdition, fromGoogleBooksVolume } from '../core/book-data.js';
import { sourcesFor } from './sources.mjs';
import { readConfig } from '../shared/data-repo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ANSWERS = join(here, '..', 'core', 'tests', 'answers');
const PAUSE_MS = 1000; // between books, as in loci-enrich

// The fields compared: those a change in a source would most likely break.
const FIELDS = ['title', 'publisher', 'year', 'pages', 'isbn'];

/** What each source's recorded answer reads as, by source name (null when nothing was recorded). */
export function recordedReadings(book) {
  const read = (text, reader) => (text ? reader(text) : null);
  return {
    'Library of Congress': read(book.libraryOfCongress, text => fromLibraryOfCongress(text, book.isbn)),
    'Open Library': read(book.openLibraryEdition, text => fromOpenLibraryEdition(JSON.parse(text), book.isbn)),
    'Google Books': read(book.googleBooksVolume, text => fromGoogleBooksVolume(JSON.parse(text), book.isbn)),
  };
}

/**
 * The fields that read differently now.
 * @returns {string[]} one line per field, empty when all agree
 */
export function differences(recorded, live) {
  if (!recorded && !live) return [];
  if (!recorded) return ['now knows the book (it did not when recorded)'];
  if (!live) return ['no longer knows the book'];
  return FIELDS.filter(field => String(recorded[field] ?? '') !== String(live[field] ?? ''))
    .map(field => `${field}: was "${recorded[field] ?? ''}", now "${live[field] ?? ''}"`);
}

/**
 * Ask every source about every recorded book and compare.
 * @param {object[]} books the recorded answer modules
 * @param {{ fetchFn?: typeof fetch, googleBooksKey?: string, pauseMs?: number }} options
 * @returns {Promise<{ lines: string[], failed: boolean }>} failed: a source did not answer or refused
 */
export async function checkSources(books, { fetchFn = fetch, googleBooksKey = '', pauseMs = 0 } = {}) {
  const lines = [];
  let failed = false;
  for (const [i, book] of books.entries()) {
    const recorded = recordedReadings(book);
    for (const [name, ask] of sourcesFor(book.isbn, { fetchFn, googleBooksKey })) {
      let live;
      try {
        live = await ask();
      } catch (error) {
        failed = true;
        lines.push(`  ${book.isbn} ${name}: ${error.message}${error.refused ? ' (refused: try again later)' : ''}`);
        continue;
      }
      for (const line of differences(recorded[name], live)) lines.push(`  ${book.isbn} ${name}: ${line}`);
    }
    if (pauseMs && i < books.length - 1) await new Promise(done => setTimeout(done, pauseMs));
  }
  const head = failed ? 'Some sources did not answer as before:' : lines.length ? 'Every source answered; these fields read differently from the recorded answers:' : 'Every source answered, and every field read as recorded.';
  return { lines: [head, ...lines], failed };
}

/** The recorded answer modules, oldest first. */
export async function loadRecordedBooks(folder = ANSWERS) {
  const files = readdirSync(folder).filter(name => name.endsWith('.js')).sort();
  return Promise.all(files.map(name => import(pathToFileURL(join(folder, name)).href)));
}

// Run from the command line.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let googleBooksKey = '';
  try { ({ googleBooksKey = '' } = readConfig()); } catch { /* without config.json, Google Books is left out */ }
  const books = await loadRecordedBooks();
  console.log(`Checking ${books.length} recorded books against the live sources${googleBooksKey ? '' : ' (Google Books left out: no key in config.json)'}…`);
  const { lines, failed } = await checkSources(books, { googleBooksKey, pauseMs: PAUSE_MS });
  console.log(lines.join('\n'));
  if (failed) process.exitCode = 1;
}
