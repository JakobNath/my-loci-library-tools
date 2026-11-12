// The shelf planner (PLAN.md, "A laptop shelf planner"): suggest an order for
// the books in one place (a room, a bookcase), fit them to its shelves by
// their thickness and each shelf's width, list the moves, and, once a person
// has moved the books and says so, record each copy's new shelf and its place
// along it. Nothing is written until then. The admin page shows it.

import { buildLibrary, isInside } from '../core/library.js';
import { estimateSize } from '../core/sizes.js';
import { keysForShelf } from '../core/shelf-order.js';
import { normalizeForSearch } from '../core/search.js';
import { withField } from '../core/records.js';

const SEPARATOR = ' › ';
// A shelf is filled to this share of its width, leaving room for a hand and for books added later.
export const FILL = 0.9;

/**
 * The shelves and their widths, one per line: "Home › Office › Case 1 › Shelf 1 = 80"
 * (centimeters). Blank lines and lines starting with # are left out.
 * @returns {{ shelves: { location: string[], width: number }[], problems: string[] }} width in millimeters
 */
export function readShelves(text) {
  const shelves = [];
  const problems = [];
  for (const [i, raw] of String(text || '').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(.+?)\s*=\s*(\d+(?:[.,]\d+)?)\s*(cm)?$/i);
    if (!match) { problems.push(`Line ${i + 1}: write it as "Home › Office › Case 1 › Shelf 1 = 80" (the width in cm).`); continue; }
    shelves.push({ location: match[1].split(/\s*›\s*/).filter(Boolean), width: Math.round(Number(match[2].replace(',', '.')) * 10) });
  }
  return { shelves, problems };
}

/** Write the shelves back as the text readShelves reads. */
export const shelvesText = shelves => shelves.map(shelf => `${shelf.location.join(SEPARATOR)} = ${shelf.width / 10}`).join('\n');

const text = value => normalizeForSearch(value || '');
const year = value => (value === null || value === undefined ? Infinity : value);
// The orders a person can choose, each a comparison of two books; ties fall to the title.
export const ORDERS = {
  author: { label: 'Author, then original date', compare: (a, b) => text(a.authorSort).localeCompare(text(b.authorSort)) || year(a.sortYear) - year(b.sortYear) },
  originalDate: { label: 'Original date, then author', compare: (a, b) => year(a.sortYear) - year(b.sortYear) || text(a.authorSort).localeCompare(text(b.authorSort)) },
  subject: { label: 'Subject (category), then author', compare: (a, b) => text(a.categories[0] || '￿').localeCompare(text(b.categories[0] || '￿')) || text(a.authorSort).localeCompare(text(b.authorSort)) || year(a.sortYear) - year(b.sortYear) },
  title: { label: 'Title', compare: () => 0 },
};

/**
 * Suggest an arrangement for the books in one place.
 * @param {object[]} records every record of the catalog
 * @param {{ place: string[], shelves: { location: string[], width: number }[], order: string }} request
 *   place: the room or bookcase whose books are arranged; shelves: its shelves in order, left to right and top to bottom
 * @returns {{ shelves: { location: string[], width: number, used: number, books: object[] }[], left: object[], moves: number }}
 *   each book: { copyId, title, author, thickness, source, from, to, moved }; left: the books that do not fit
 */
export function planShelves(records, { place, shelves, order = 'author' }) {
  const library = buildLibrary(records, { searchText: false });
  const compare = (ORDERS[order] || ORDERS.author).compare;
  const books = [];
  for (const entry of library.entries) {
    if (entry.isDigital) continue;
    for (const copy of entry.copies) {
      if (copy.status !== 'owned' || !copy.location.length || !isInside(copy.location, place)) continue;
      const size = estimateSize(entry.edition, { binding: copy.binding });
      books.push({
        copyId: copy.id, entry, title: entry.edition.title, author: entry.authorLine, from: copy.location.filter(Boolean), fromOrder: copy.shelfOrder || '',
        thickness: size.thickness.mm, source: size.thickness.source,
      });
    }
  }
  books.sort((a, b) => compare(a.entry, b.entry) || text(a.title).localeCompare(text(b.title)) || a.copyId.localeCompare(b.copyId));
  const planned = shelves.map(shelf => ({ ...shelf, used: 0, books: [] }));
  let at = 0;
  const left = [];
  for (const book of books) {
    // The next shelf with room; a book wider than any shelf's room is left over.
    while (at < planned.length && planned[at].used + book.thickness > planned[at].width * FILL && planned[at].books.length) at++;
    if (at >= planned.length || book.thickness > planned[at].width * FILL) { left.push(book); continue; }
    planned[at].books.push(book);
    planned[at].used += book.thickness;
  }
  let moves = 0;
  for (const shelf of planned) {
    for (const book of shelf.books) {
      book.to = shelf.location;
      book.moved = book.from.join(SEPARATOR) !== shelf.location.join(SEPARATOR);
      if (book.moved) moves++;
    }
  }
  return { shelves: planned, left, moves, order: (ORDERS[order] || ORDERS.author).label };
}

/**
 * The records to write once the books stand as planned: each copy's new
 * location, and new shelf-order keys along each shelf.
 * @returns {object[]} the changed copy records
 */
export function recordsForPlan(records, plan, now) {
  const byId = new Map(records.map(record => [record.id, record]));
  const changed = [];
  for (const shelf of plan.shelves) {
    const keys = keysForShelf(shelf.books.length);
    shelf.books.forEach((book, i) => {
      let copy = byId.get(book.copyId);
      if (!copy) return;
      const before = copy;
      if (copy.location.join(SEPARATOR) !== shelf.location.join(SEPARATOR)) copy = withField(copy, 'location', [...shelf.location], now);
      if (copy.shelfOrder !== keys[i]) copy = withField(copy, 'shelfOrder', keys[i], now);
      if (copy !== before) changed.push(copy);
    });
  }
  return changed;
}

/** The plan as plain text, for the page and for printing: shelf by shelf, with the moves marked. */
export function planText(plan) {
  const cm = mm => `${Math.round(mm / 10)} cm`;
  const lines = [`Order: ${plan.order}. ${plan.moves} books change shelf.`];
  for (const shelf of plan.shelves) {
    lines.push('', `${shelf.location.join(SEPARATOR)} (${cm(shelf.width)}, ${cm(shelf.used)} used)`);
    shelf.books.forEach((book, i) => lines.push(`  ${i + 1}. ${book.author ? `${book.author}, ` : ''}${book.title}${book.moved ? `   ← from ${book.from.join(SEPARATOR)}` : ''}`));
  }
  if (plan.left.length) lines.push('', `Do not fit (${plan.left.length}, ${cm(plan.left.reduce((sum, book) => sum + book.thickness, 0))}):`, ...plan.left.map(book => `  ${book.author ? `${book.author}, ` : ''}${book.title}`));
  return lines.join('\n');
}
