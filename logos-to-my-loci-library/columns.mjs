// Reading the Logos Library export (a collection or the Library, Print/Export
// as a CSV spreadsheet): the CSV text, and which column fills which field.
// The column names were checked against a real export of 53 resources
// (2026-11-10); each field also lists other names a later Logos might use.
// Every other column is kept as it came, in the edition's `logosExtra`
// (DATA_FORMAT.md, "Edition"), except the few in VOLATILE.

import { isbn13 } from '../core/entry.js';

export const COLUMNS = {
  logosId: ['Resource ID', 'ResourceId', 'Resource Id', 'Resource'],
  title: ['Title'],
  subtitle: ['Subtitle'],
  authors: ['Author', 'Authors', 'Creator', 'Creators'],
  publisher: ['Publishers', 'Publisher'],
  year: ['Publication Date', 'Date', 'Year', 'Published'],
  // No ISBN column in the 2026 export; kept in case a later one has it.
  series: ['Series'],
  languages: ['Language', 'Languages'],
  isbn: ['ISBN'],
};

// Columns that change with every export without the book changing (Logos's own
// bookkeeping, and what other users rate or tag). Keeping them would make
// every book look edited on every import, so they are left out.
export const VOLATILE = ['Metadata Version', 'File Version', 'Last Updated', 'Community Rating', 'Community Tags'];

/**
 * The year a book was published, from the export's date: its first year,
 * so "1884–1885" is 1884 and "1993 [2008]" is 1993; "n.d." (no date) is none.
 */
export function yearOf(text) {
  const match = String(text || '').match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

/**
 * Parse CSV (or tab-separated) text: quoted cells may hold commas, quotes
 * (doubled) and line breaks. The first row names the columns.
 * @returns {Record<string, string>[]} one object per row, by column name
 */
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.indexOf('\n') + 1 || undefined);
  const separator = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === separator) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(value => value !== '')) rows.push(row); }
  const [header = [], ...body] = rows;
  const names = header.map(name => name.trim());
  return body.map(values => Object.fromEntries(names.map((name, i) => [name, (values[i] ?? '').trim()])));
}

/** The text of a file as Logos may write it: UTF-8 (with or without a mark) or UTF-16. */
export function decodeExport(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

/** A name as Logos may write it ("Lewis, C. S.") in reading order, with its sort form. */
export function personName(text) {
  const parts = text.split(',').map(part => part.trim());
  if (parts.length === 2 && parts[0] && parts[1]) return { name: `${parts[1]} ${parts[0]}`, sortName: `${parts[0]}, ${parts[1]}` };
  return { name: text.trim(), sortName: null };
}

/**
 * One export row read into the fields the importer uses, and the rest.
 * @returns {{ logosId: string, title: string, subtitle: string|null, authors: { name: string, sortName: string|null }[], publisher: string|null, year: number|null, series: string|null, languages: string[], isbn: string|null, extra: Record<string, string> }}
 */
export function readRow(row) {
  const used = new Set();
  const value = field => {
    const name = COLUMNS[field].find(column => column in row);
    if (!name) return '';
    used.add(name);
    return row[name];
  };
  // Logos writes a subtitle after the title's first colon ("Romans: A New Translation…").
  const fullTitle = value('title');
  const ownSubtitle = value('subtitle');
  const colon = fullTitle.indexOf(': ');
  const split = !ownSubtitle && colon > 0;
  const read = {
    logosId: value('logosId'),
    title: split ? fullTitle.slice(0, colon) : fullTitle,
    subtitle: ownSubtitle || (split ? fullTitle.slice(colon + 2) : null),
    authors: value('authors').split(/;|\s+&\s+|\s+and\s+/).map(text => text.trim()).filter(Boolean).map(personName),
    publisher: value('publisher') || null,
    year: yearOf(value('year')),
    series: value('series') || null,
    languages: value('languages').split(/[;,]/).map(text => text.trim()).filter(Boolean),
    isbn: isbn13(value('isbn')),
  };
  read.extra = Object.fromEntries(Object.entries(row).filter(([name, text]) => !used.has(name) && !VOLATILE.includes(name) && text !== ''));
  return read;
}
