// Known sets (PLAN.md, "Anthologies"): checked contents lists for large sets,
// one plain text file per set in sets/, read here. A volume of a known set,
// scanned or typed, takes its works from the list, with authors, original
// titles and languages, dates and translators, so nobody types them. The
// lists are checked by a person before they are used; a list says so with a
// "checked:" line, and only then are its dates filled in without another tap
// (PLAN.md, "Original dates"). Until then they are offered, like Wikidata's.
//
// The file format, described for people in DATA_FORMAT.md ("sets/"):
//
//   # Any line starting with # is a note.
//   set: Great Books of the Western World
//   publisher: Encyclopaedia Britannica
//   place: Chicago
//   year: 1990
//   edition: 2nd ed.
//   isbn: 9780852291634           an ISBN printed on every volume (any number of lines)
//   checked: 2026-11-12 Jakob Nath  who checked the list against its sources, and when
//
//   volume: 6 | Plato | isbn 9780852291634
//   Plato — Euthyphro | Εὐθύφρων | Greek — c. 399–395 BC | trans. Benjamin Jowett | pp. 1–8
//   Plato — Apology | Ἀπολογία Σωκράτους | Greek — c. 399–390 BC | trans. Benjamin Jowett
//   Edgar Allan Poe — The Raven | | English — 1845 | piece
//
// A work line is "Author — Title", then, separated by " | ": the original
// title, "Language — date", and any of "trans. <name>", "pp. <pages>" and
// "piece" (a short work kept inside the book: a poem, hymn, sermon or letter).
// Empty parts keep their separators.

import { isbn13, datingsFromRows } from './entry.js';
import { newRecord } from './records.js';
import { normalizeForSearch } from './search.js';

// The parts of a line, separated by a bar with any spaces around it ("a | | b" has an empty middle part).
const PARTS = /\s*\|\s*/;

const HEADER_KEYS = { set: 'set', publisher: 'publisher', place: 'place', year: 'year', edition: 'editionStatement', checked: 'checked' };

// "Author — Title", split on the first dash with spaces around it.
function authorAndTitle(text) {
  const match = text.match(/^(.*?)\s+[—–]\s+(.*)$/);
  return match ? { author: match[1].trim(), title: match[2].trim() } : { author: '', title: text.trim() };
}

function workLine(line, number) {
  const [main, originalTitle = '', languageDate = '', ...extras] = line.split(PARTS).map(part => part.trim());
  const { author, title } = authorAndTitle(main);
  const [language = '', date = ''] = languageDate.split(/\s+[—–]\s+/).map(part => part.trim());
  const extra = prefix => (extras.find(part => part.startsWith(prefix)) || '').slice(prefix.length).trim();
  return {
    author, title, originalTitle, originalLanguage: language, date,
    translator: extra('trans.'), pages: extra('pp.'), piece: extras.includes('piece'), line: number,
  };
}

/**
 * Read a known set's file.
 * @param {string} text the file
 * @returns {{ set: string, publisher: string, place: string, year: string, editionStatement: string, checked: string, isbns: string[],
 *   volumes: { label: string, title: string, isbns: string[], works: object[] }[], problems: string[] }}
 *   problems: lines that could not be read, in plain words (an empty list when the file is sound)
 */
export function parseKnownSet(text) {
  const result = { set: '', publisher: '', place: '', year: '', editionStatement: '', checked: '', isbns: [], volumes: [], problems: [] };
  let volume = null;
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const number = i + 1;
    if (!line || line.startsWith('#')) return;
    const header = line.match(/^(set|publisher|place|year|edition|checked|isbn|volume):\s*(.*)$/i);
    if (header) {
      const [, key, value] = header;
      if (key.toLowerCase() === 'volume') {
        const [label, title = '', ...rest] = value.split(PARTS).map(part => part.trim());
        const isbns = rest.filter(part => /^isbn\s/i.test(part)).map(part => isbn13(part.slice(5))).filter(Boolean);
        volume = { label, title, isbns, works: [] };
        result.volumes.push(volume);
      } else if (key.toLowerCase() === 'isbn') {
        const isbn = isbn13(value);
        if (isbn) result.isbns.push(isbn);
        else result.problems.push(`Line ${number}: "${value}" is not an ISBN.`);
      } else {
        result[HEADER_KEYS[key.toLowerCase()]] = value;
      }
      return;
    }
    if (!volume) { result.problems.push(`Line ${number}: a work before any "volume:" line.`); return; }
    const work = workLine(line, number);
    if (!work.title) result.problems.push(`Line ${number}: a work needs a title.`);
    else volume.works.push(work);
  });
  if (!result.set) result.problems.push('The file has no "set:" line.');
  return result;
}

const labelKey = label => normalizeForSearch(label).replace(/^(v|vol|volume)\s+/, '');

/**
 * The known set and volume a book belongs to: by an ISBN of its own volume,
 * or by its set's title and volume label (a book without a barcode, or a
 * Logos copy of the set). An ISBN the whole set shares (Great Books prints one
 * on every volume) finds the set but not the volume: then `volume` is null,
 * and the person is asked which volume it is.
 * @param {ReturnType<parseKnownSet>[]} sets
 * @param {{ isbn?: string, set?: string, volume?: string }} book
 * @returns {{ set: object, volume: object|null }|null}
 */
export function findKnownVolume(sets, { isbn = '', set: setTitle = '', volume: label = '' }) {
  for (const set of sets) {
    const byIsbn = isbn && set.volumes.find(item => item.isbns.includes(isbn));
    if (byIsbn) return { set, volume: byIsbn };
    const sameSet = (setTitle && normalizeForSearch(setTitle) === normalizeForSearch(set.set)) || (isbn && set.isbns.includes(isbn));
    if (!sameSet) continue;
    const byLabel = label && set.volumes.find(item => labelKey(item.label) === labelKey(label));
    return { set, volume: byLabel || null };
  }
  return null;
}

/**
 * A volume's works as contents lines for the entry form ("Author — Title — date",
 * core/contents.js), so they are saved the way pasted contents are.
 */
export function contentsLinesOf(volume) {
  return volume.works.map(work => [work.author, work.title, work.date].filter(Boolean).join(' — ')).join('\n');
}

/**
 * Which volumes of a set we hold, and which we lack ("set gaps", PLAN.md,
 * "Library and Wishlist views").
 * @param {ReturnType<parseKnownSet>} set
 * @param {string[]} heldLabels the volume labels of our books in this set
 * @returns {{ held: string[], missing: string[] }} labels, in the list's order
 */
export function setGaps(set, heldLabels) {
  const held = new Set(heldLabels.map(labelKey));
  const labels = set.volumes.map(volume => volume.label);
  return { held: labels.filter(label => held.has(labelKey(label))), missing: labels.filter(label => !held.has(labelKey(label))) };
}

/**
 * Wishlist items for a set's missing volumes ("Put the missing on the
 * wishlist"), one per volume, leaving out any already on the wishlist.
 * @param {ReturnType<parseKnownSet>} set
 * @param {string[]} missing volume labels, from setGaps
 * @param {object[]} wishes the wishlist items already there
 * @returns {{ title: string, authors: string, publisher: string, notes: string }[]} values for wishFromForm (core/entry.js)
 */
export function wishesForGaps(set, missing, wishes) {
  const have = new Set(wishes.filter(wish => !wish.trashed).map(wish => normalizeForSearch(wish.title)));
  return set.volumes
    .filter(volume => missing.includes(volume.label))
    .map(volume => ({
      title: `${set.set} ${volume.label}${volume.title ? `: ${volume.title}` : ''}`,
      authors: [...new Set(volume.works.map(work => work.author).filter(Boolean))].slice(0, 4).join('; '),
      publisher: set.publisher,
      notes: [set.editionStatement, set.year].filter(Boolean).join(', '),
    }))
    .filter(item => !have.has(normalizeForSearch(item.title)));
}

/**
 * The works and contents of a known set's volume, as records, for a book made
 * without the entry form (a Logos resource of the set, on the laptop). Each
 * work gets the list's original title and language, and, when the list is
 * checked, its date; a piece stays inside the contents.
 * @param {ReturnType<parseKnownSet>} set
 * @param {object} volume one of set.volumes
 * @param {{ newId: () => string, now: string, authorIds: (names: string[]) => string[] }} context
 *   authorIds: the IDs of authors by name, making any not yet in the catalog
 * @returns {{ works: object[], contents: object[] }}
 */
export function recordsForKnownVolume(set, volume, { newId, now, authorIds }) {
  const works = [];
  const contents = volume.works.map(item => {
    const entry = { work: null, piece: null, extent: 'complete', translator: item.translator || null, pages: item.pages || null, cite: false };
    if (item.piece) return { ...entry, piece: { title: item.title, author: item.author || null, originalTitle: item.originalTitle || null, date: item.date || null } };
    const reading = set.checked && item.date ? datingsFromRows([{ text: item.date, working: true, note: `from the ${set.set} list` }]) : { datings: [] };
    const work = newRecord('work', newId(), now, {
      title: item.title, authors: authorIds(item.author ? item.author.split(/\s+and\s+/) : []),
      originalTitle: item.originalTitle || null, originalLanguage: item.originalLanguage || null, datings: reading.datings,
    });
    works.push(work);
    return { ...entry, work: work.id };
  });
  return { works, contents };
}
