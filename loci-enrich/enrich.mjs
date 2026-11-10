// What loci-enrich fills in (PLAN.md, "loci-enrich"): empty fields only, from
// one book's merged answer (core/book-data.js). A field is filled once: what
// the tool wrote is kept in the data repository (integrations/enrich.json),
// and a field it once wrote is never touched again, so a value a person
// changed or cleared stays as they left it. Original dates are never filled;
// the contents of an anthology are only suggested, and never for a Bible.

import { withField } from '../core/records.js';
import { isBible } from '../core/bible.js';
import { normalizeForSearch } from '../core/search.js';

export const RECHECK_DAYS = 90; // each book is asked again after this long, so new catalog records are found

// The edition fields filled, as [field, its name in the report].
const EDITION_FIELDS = [['pages', 'pages'], ['editionStatement', 'edition'], ['series', 'series'], ['seriesNumber', 'number'], ['place', 'place']];
// Fields of the work, filled only for a book holding one work.
const WORK_FIELDS = ['originalTitle', 'originalLanguage'];
// The catalogue numbers (DATA_FORMAT.md, "Identifiers"), as the report names them.
const NUMBER_NAMES = { lccn: 'LCCN', oclc: 'OCLC', lcc: 'call number', ddc: 'Dewey' };
// The roles taken from a record into an edition that names no contributors yet.
const ROLES = ['translator', 'editor'];

const isEmpty = value => value === null || value === '' || (Array.isArray(value) && !value.length);
const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 86400000;

/**
 * The editions to ask about this time: every edition with an ISBN, not in
 * the trash, never asked, asked under another ISBN, or asked more than
 * RECHECK_DAYS ago. Those never asked come first, so a long first run
 * carries on where it stopped.
 * @param {object[]} editions
 * @param {{ books: Record<string, { isbn: string, asked: string }> }} memory integrations/enrich.json
 * @param {string} today YYYY-MM-DD
 */
export function editionsToAsk(editions, memory, today) {
  const due = editions.filter(edition => {
    if (edition.trashed || !edition.isbn) return false;
    const known = memory.books[edition.id];
    return !known || known.isbn !== edition.isbn || daysBetween(known.asked, today) >= RECHECK_DAYS;
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
 *   wrote: everything this tool has written for the book; contents: suggested works for an anthology
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
    // Contents are suggested for a person to enter, never written, and never for a Bible.
    const listed = found.contents.map(entry => (entry.author ? `${entry.author} — ${entry.title}` : entry.title));
    if (listed.length > 1 && !isBible({ edition, works }) && !isBible({ edition, works: found.contents })) result.contents = listed;
  }
  return result;
}
