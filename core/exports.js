// Exports (PLAN.md, "Settings", "Data and care"): the catalog as CSV (for a
// spreadsheet or an insurance agent), JSON (every record, as stored), CSL-JSON
// (for citation managers) and BibTeX (for LaTeX). Each keeps titles, authors,
// editions and original dates. Pure text in, text out; the screen saves it.

import { workingDating, formatYearRange } from './dating.js';
import { editionToCsl, citationKeyBase, freeCitationKey } from './zotero.js';
import { valueSummary } from './value.js';

// A CSV cell: quoted when it holds a comma, quote or line break, quotes doubled (RFC 4180).
function cell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csvText = rows => `${rows.map(row => row.map(cell).join(',')).join('\r\n')}\r\n`;

/** The original date as written: one work's working dating, or an anthology's span. */
export function originalDateText(entry, style = 'AD') {
  if (entry.range) return entry.range.earliest === null ? '' : formatYearRange(entry.range.earliest, entry.range.latest, style);
  const dating = entry.works[0] && workingDating(entry.works[0]);
  return dating ? dating.text : '';
}

const CSV_COLUMNS = ['Title', 'Subtitle', 'Authors', 'Original date', 'Translators', 'Editors', 'Publisher', 'Place', 'Year',
  'Edition', 'Series', 'Volume', 'ISBN', 'LCCN', 'OCLC', 'LC call number', 'Dewey number', 'Subjects', 'Pages', 'Format', 'Binding', 'Location', 'Status', 'Value', 'Price paid', 'Added', 'Notes', 'ID'];

/**
 * One row per copy (a book with no copy still gets a row), every edition, owned or not.
 * @param {object[]} entries the library's entries
 */
export function catalogCsv(entries, { dateStyle = 'AD' } = {}) {
  const rows = [CSV_COLUMNS];
  for (const entry of entries) {
    const { edition } = entry;
    const people = role => edition.contributors.filter(person => person.role === role).map(person => person.name).join('; ');
    const book = [edition.title, edition.subtitle, entry.authors.map(author => author.name).join('; '), originalDateText(entry, dateStyle),
      people('translator'), people('editor'), edition.publisher, edition.place, edition.year, edition.editionStatement,
      [edition.series, edition.seriesNumber].filter(Boolean).join(' '), [edition.set, edition.volume].filter(Boolean).join(', vol. '),
      edition.isbn, edition.identifiers.lccn, edition.identifiers.oclc, edition.identifiers.lcc, edition.identifiers.ddc, edition.subjects.join('; '),
      edition.pages, entry.isDigital ? 'Logos' : 'Physical'];
    const copies = entry.copies.length ? entry.copies : [null];
    for (const copy of copies) {
      rows.push([...book, copy && copy.binding, copy && copy.location.filter(Boolean).join(' › '), copy && copy.status,
        copy && copy.value, copy && copy.price, copy && copy.added, copy && copy.notes, edition.id]);
    }
  }
  return csvText(rows);
}

/**
 * For an insurance agent: each owned physical copy with its value, then the
 * totals by room and the count with no value. Logos books are left out.
 */
export function valueCsv(entries, { currency = '$' } = {}) {
  const rows = [['Title', 'Authors', 'Publisher', 'Year', 'Binding', 'Location', `Value (${currency})`]];
  for (const entry of entries) {
    if (entry.isDigital) continue;
    for (const copy of entry.copies) {
      if (copy.status !== 'owned') continue;
      rows.push([entry.edition.title, entry.authors.map(author => author.name).join('; '), entry.edition.publisher, entry.edition.year,
        copy.binding, copy.location.filter(Boolean).join(' › '), copy.value]);
    }
  }
  const summary = valueSummary(entries);
  rows.push([], ['Total', '', '', '', '', '', summary.total]);
  for (const place of summary.byPlace) rows.push([`Total: ${place.place}`, '', '', '', '', '', place.total]);
  rows.push([`Books with no value yet: ${summary.missing}`]);
  return csvText(rows);
}

/** Every record as stored, in one file shaped like catalog.json (DATA_FORMAT.md). */
export function catalogJson(records, built) {
  const lists = { works: [], editions: [], copies: [], authors: [], wishlist: [] };
  const listOf = { work: 'works', edition: 'editions', copy: 'copies', author: 'authors', wishlist: 'wishlist' };
  for (const record of records) if (listOf[record.type]) lists[listOf[record.type]].push(record);
  for (const list of Object.values(lists)) list.sort((a, b) => a.id.localeCompare(b.id));
  return `${JSON.stringify({ format: 1, built, ...lists }, null, 2)}\n`;
}

/** CSL-JSON: one item per edition, with its original date (core/zotero.js). */
export function cslJson(entries, worksById, authorsById) {
  return `${JSON.stringify(entries.map(entry => editionToCsl(entry.edition, worksById, authorsById)), null, 2)}\n`;
}

// BibTeX text: braces kept balanced, and the characters LaTeX treats as commands escaped.
const bibText = text => String(text).replace(/[{}]/g, '').replace(/([&%$#_])/g, '\\$1');
const bibName = name => (name.literal ? `{${bibText(name.literal)}}` : `${bibText(name.family)}, ${bibText(name.given)}`);
// biblatex dates are four digits, and years before Christ are counted astronomically:
// 1 BC is 0000, so 399 BC (stored as -399) is -0398.
const bibYear = year => (year > 0 ? String(year).padStart(4, '0') : `-${String(-(year + 1)).padStart(4, '0')}`);
// biblatex marks an approximate year with "~" and a span with "/": c. 397–400 is 0397~/0400~.
const bibDate = date => date['date-parts'].map(([year]) => bibYear(year) + (date.circa ? '~' : '')).join('/');

/**
 * BibTeX (biblatex fields): @book entries keyed as in Zotero, author + year
 * ("Augustine1991", core/zotero.js), with a, b, c added when two books share a
 * key; the original date is "origdate".
 */
export function bibtex(entries, worksById, authorsById) {
  const used = new Set();
  const out = [];
  for (const entry of entries) {
    const item = editionToCsl(entry.edition, worksById, authorsById);
    const key = freeCitationKey(citationKeyBase(item, entry.edition.year), used);
    used.add(key);
    const fields = [
      ['title', item['volume-title'] || item.title],
      ['maintitle', item['volume-title'] ? item.title : null],
      ['author', item.author.map(bibName).join(' and ')],
      ['editor', (item.editor || []).map(bibName).join(' and ')],
      ['translator', (item.translator || []).map(bibName).join(' and ')],
      ['publisher', item.publisher],
      ['location', item['publisher-place']],
      ['year', entry.edition.year],
      ['origdate', item['original-date'] && bibDate(item['original-date'])],
      ['edition', item.edition],
      ['series', item['collection-title']],
      ['number', item['collection-number']],
      ['volume', item.volume],
      ['isbn', item.ISBN],
      ['language', item.language],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
    out.push(`@book{${key},\n${fields.map(([name, value]) => `  ${name} = {${name === 'author' || name === 'editor' || name === 'translator' ? value : bibText(value)}}`).join(',\n')}\n}`);
  }
  return `${out.join('\n\n')}\n`;
}
