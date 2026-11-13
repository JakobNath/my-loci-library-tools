// What loci-enrich fills in (PLAN.md, "loci-enrich"): empty fields only, from
// one book's merged answer (core/book-data.js). A field is filled once: what
// the tool wrote is kept in the data repository (integrations/enrich.json),
// and a field it once wrote is never touched again, so a value a person
// changed or cleared stays as they left it. Original dates are never filled;
// works a catalog lists inside a book entered as one work are only offered
// ("foundContents", used or declined in the app), and never for a Bible.

import { withField } from '../core/records.js';
import { isBible } from '../core/bible.js';
import { normalizeForSearch } from '../core/search.js';

export const RECHECK_DAYS = 90; // each book is asked again after this long, so new catalog records are found
// A book that a source did not answer (it failed, or was resting) is asked again after this long:
// soon enough to fill what that source knows, rare enough not to ask every book daily while a source is down.
export const RETRY_DAYS = 7;

// The edition fields filled, as [field, its name in the report].
const EDITION_FIELDS = [['pages', 'pages'], ['editionStatement', 'edition'], ['series', 'series'], ['seriesNumber', 'number'], ['place', 'place']];
// Fields of the work, filled only for a book holding one work.
const WORK_FIELDS = ['originalTitle', 'originalLanguage'];
// The catalogue numbers (DATA_FORMAT.md, "Identifiers"), as the report names them.
const NUMBER_NAMES = { lccn: 'LCCN', oclc: 'OCLC', lcc: 'call number', ddc: 'Dewey', openLibrary: 'Open Library ID', hathiTrust: 'HathiTrust record' };
// The roles taken from a record into an edition that names no contributors yet.
const ROLES = ['translator', 'editor'];

const isEmpty = value => value === null || value === '' || (Array.isArray(value) && !value.length);
const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

/**
 * What a book is asked by: its ISBN, or for a book without one its LCCN or
 * OCLC number ("lccn:2002032744", "oclc:52839448"), or '' when it has none.
 * Kept in integrations/enrich.json as "isbn", so a changed number is asked again.
 */
export function askKey(edition) {
  if (edition.isbn) return edition.isbn;
  const { lccn, oclc } = edition.identifiers || {};
  return lccn ? `lccn:${lccn}` : oclc ? `oclc:${oclc}` : '';
}

/**
 * The editions to ask about this time: every edition with an ISBN (or, without
 * one, an LCCN or OCLC number), not in the trash, never asked, asked under
 * another number, asked more than RECHECK_DAYS ago, or missed by a source
 * more than RETRY_DAYS ago. Those never asked come first, so a long first run
 * carries on where it stopped.
 * @param {object[]} editions
 * @param {{ books: Record<string, { isbn: string, asked: string, missed?: string[] }> }} memory integrations/enrich.json
 * @param {string} today YYYY-MM-DD
 */
export function editionsToAsk(editions, memory, today) {
  const due = editions.filter(edition => {
    if (edition.trashed || !askKey(edition)) return false;
    const known = memory.books[edition.id];
    if (!known || known.isbn !== askKey(edition)) return true;
    const days = daysBetween(known.asked, today);
    return days >= RECHECK_DAYS || (Boolean(known.missed) && days >= RETRY_DAYS);
  });
  return due.sort((a, b) => Number(Boolean(memory.books[a.id])) - Number(Boolean(memory.books[b.id])));
}

/**
 * Fill one book's empty fields from its merged answer.
 * @param {{ edition: object, works: object[] }} book the edition and its works
 * @param {import('../core/lookup.js').Found|null} found the merged answer, or null when no source knew the book
 * @param {{ wrote?: Record<string, unknown> }} [previous] what this tool wrote for the book before
 * @param {string} now timestamp for the changed fields
 * @returns {{ changed: object[], filled: string[], wrote: Record<string, unknown>, contents: string[] }}
 *   changed: the records that changed; filled: what was filled, for the report;
 *   wrote: everything this tool has written for the book; contents: works found inside, as lines for the report
 */
export function fillBook({ edition, works }, found, previous = {}, now) {
  const wrote = { ...(previous.wrote || {}) };
  const filled = [];
  const result = { changed: [], filled, wrote, contents: [] };
  if (!found) return result;
  // A field is the tool's to fill only while it is empty and the tool never wrote it.
  const mayFill = (key, current) => isEmpty(current) && !(key in wrote);
  let next = edition;
  const fill = (field, value, label) => {
    next = withField(next, field, value, now);
    wrote[field] = value;
    filled.push(label);
  };

  // A catalog's series is often the set the book already names (Chemnitz's Works): then it adds nothing.
  const repeatsSet = Boolean(edition.set) && normalizeForSearch(edition.set) === normalizeForSearch(found.series);
  for (const [field, label] of EDITION_FIELDS) {
    if (repeatsSet && field.startsWith('series')) continue;
    if (!isEmpty(found[field]) && mayFill(field, next[field])) fill(field, found[field], `${label} ${found[field]}`);
  }
  if (found.height && mayFill('height', next.height)) {
    fill('height', found.height, `height ${found.height / 10} cm`);
    next = withField(next, 'heightSource', 'catalog', now);
  }
  if (found.thickness && mayFill('thickness', next.thickness)) {
    fill('thickness', found.thickness, `thickness ${found.thickness / 10} cm`);
    next = withField(next, 'thicknessSource', 'catalog', now);
  }
  // Catalogue numbers one by one, so a number a person typed stays beside the ones filled in.
  const numbers = Object.entries(found.identifiers).filter(([key, value]) => value && mayFill(`identifiers.${key}`, next.identifiers[key]));
  if (numbers.length) {
    next = withField(next, 'identifiers', { ...next.identifiers, ...Object.fromEntries(numbers) }, now);
    for (const [key, value] of numbers) wrote[`identifiers.${key}`] = value;
    filled.push(numbers.map(([key, value]) => `${NUMBER_NAMES[key]} ${value}`).join('; '));
  }
  if (found.subjects.length && mayFill('subjects', next.subjects)) fill('subjects', found.subjects, `${found.subjects.length} subject headings`);
  const people = found.contributors.filter(person => ROLES.includes(person.role));
  if (people.length && mayFill('contributors', next.contributors)) {
    fill('contributors', people, people.map(person => `${person.role} ${person.name}`).join(', '));
  }
  // Works a catalog lists inside a book entered as one work wait in "foundContents" for a person
  // (the app's entry form offers them), never for a Bible, and only once: declined, they stay declined.
  const listed = works.length === 1 ? found.contents.filter(entry => entry.title) : [];
  if (listed.length > 1 && !isBible({ edition, works }) && !isBible({ edition, works: listed })) {
    result.contents = listed.map(entry => (entry.author ? `${entry.author} — ${entry.title}` : entry.title));
    if (mayFill('foundContents', next.foundContents)) {
      fill('foundContents', listed.map(entry => ({ author: entry.author || null, title: entry.title, extent: null })), `${listed.length} works found inside, offered in the app`);
    }
  }
  if (next !== edition) result.changed.push(next);

  if (works.length === 1) {
    let work = works[0];
    for (const field of WORK_FIELDS) {
      const key = `work.${field}`;
      if (!isEmpty(found[field]) && isEmpty(work[field]) && !(key in wrote)) {
        work = withField(work, field, found[field], now);
        wrote[key] = found[field];
        filled.push(`${field === 'originalTitle' ? 'original title' : 'original language'} ${found[field]}`);
      }
    }
    if (work !== works[0]) result.changed.push(work);
  }
  return result;
}

/**
 * Whether a book's number was corrected since the tool last asked about it,
 * so what it filled came from another book. A book first asked by its LCCN or
 * OCLC number that has since been given an ISBN is the same book, not a correction.
 * @param {string} before the number asked last time (askKey)
 * @param {string} now the number asked now
 */
export function isCorrectedNumber(before, now) {
  if (!before || before === now) return false;
  return !(before.includes(':') && !now.includes(':'));
}

/**
 * After a corrected number: clear every value the tool filled that a person
 * has not changed since, so the right book's answer can fill it. A value a
 * person changed or cleared stays as they left it, and stays the person's.
 * @param {{ edition: object, works: object[] }} book the edition and its works
 * @param {Record<string, unknown>} wrote what the tool wrote for the book
 * @param {string} now timestamp for the changed fields
 * @returns {{ edition: object, works: object[], wrote: Record<string, unknown>, cleared: string[] }}
 *   the book with those values emptied, what the tool still counts as written, and the fields cleared
 */
export function clearWritten({ edition, works }, wrote, now) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const left = { ...wrote };
  const cleared = [];
  let next = edition;
  let work = works.length === 1 ? works[0] : null;
  for (const [key, value] of Object.entries(wrote)) {
    if (key.startsWith('identifiers.')) {
      const name = key.slice(12);
      if (!same(next.identifiers[name], value)) continue;
      next = withField(next, 'identifiers', { ...next.identifiers, [name]: null }, now);
    } else if (key.startsWith('work.')) {
      if (!work || !same(work[key.slice(5)], value)) continue;
      work = withField(work, key.slice(5), null, now);
    } else {
      if (!same(next[key], value)) continue;
      next = withField(next, key, Array.isArray(value) ? [] : null, now);
      // The height's "catalog" mark goes with the height the catalog gave.
      if (key === 'height' || key === 'thickness') next = withField(next, `${key}Source`, null, now);
    }
    delete left[key];
    cleared.push(key);
  }
  return { edition: next, works: work && work !== works[0] ? [work] : works, wrote: left, cleared };
}

// A written value's field in a source's reading: "identifiers.lccn", "work.originalTitle", "pages".
function readingOf(found, key) {
  if (key.startsWith('identifiers.')) return found.identifiers[key.slice(12)];
  if (key.startsWith('work.')) return found[key.slice(5)];
  return found[key];
}

/**
 * Which source gave each value written this time: the first, in the order
 * asked, whose own reading holds that value. Kept in integrations/enrich.json
 * ("from"), so a wrong value can be traced to its source.
 * @param {Record<string, unknown>} wrote everything the tool has written for the book
 * @param {Record<string, unknown>} before what it had written before this run
 * @param {{ name: string, found: object|null }[]} answers each source's reading, best first
 * @returns {Record<string, string>} field to source name, for the fields written this time
 */
export function sourcesOfWritten(wrote, before, answers) {
  const from = {};
  for (const [key, value] of Object.entries(wrote)) {
    if (key in before) continue;
    const giving = answers.find(answer => answer.found && (key === 'contributors'
      ? answer.found.contributors.some(person => (value || []).some(written => written.name === person.name))
      : JSON.stringify(readingOf(answer.found, key)) === JSON.stringify(value)));
    if (giving) from[key] = giving.name;
  }
  return from;
}
