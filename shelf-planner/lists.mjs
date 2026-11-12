// Printed shelf lists (PLAN.md, "Printing shelf lists"): for a place (a
// bookcase, a room), each shelf with its books, in their order along the shelf
// or by original date, as a page made for paper. The admin page opens it, and
// the browser prints it. An anthology is listed once, at its earliest date.

import { buildLibrary, isInside } from '../core/library.js';
import { workingDating, formatYearRange } from '../core/dating.js';
import { normalizeForSearch } from '../core/search.js';

const SEPARATOR = ' › ';

/** A book's original date as the list shows it: the working dating as written, or an anthology's span. */
function dateOf(entry) {
  if (entry.works.length === 1) {
    const dating = workingDating(entry.works[0]);
    return dating ? dating.text : '';
  }
  return entry.range && entry.range.earliest !== null ? formatYearRange(entry.range.earliest, entry.range.latest) : '';
}

/**
 * The shelves under a place, each with its books.
 * @param {object[]} records every record of the catalog
 * @param {string[]} place
 * @param {'shelf'|'date'} order along the shelf, or by original date
 * @returns {{ shelf: string, books: { author: string, title: string, date: string, year: number|null }[] }[]}
 */
export function shelfLists(records, place, order = 'shelf') {
  const library = buildLibrary(records, { searchText: false });
  const shelves = new Map();
  for (const entry of library.entries) {
    if (entry.isDigital) continue;
    for (const copy of entry.copies) {
      const location = copy.location.filter(Boolean);
      if (copy.status !== 'owned' || !location.length || !isInside(location, place)) continue;
      const shelf = location.join(SEPARATOR);
      if (!shelves.has(shelf)) shelves.set(shelf, []);
      shelves.get(shelf).push({ entry, order: copy.shelfOrder || '' });
    }
  }
  const byShelf = (a, b) => (a.order && b.order ? (a.order < b.order ? -1 : a.order > b.order ? 1 : 0) : a.order ? -1 : b.order ? 1 : 0);
  const byDate = (a, b) => (a.entry.sortYear ?? Infinity) - (b.entry.sortYear ?? Infinity);
  const title = item => normalizeForSearch(item.entry.edition.title);
  return [...shelves.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([shelf, items]) => ({
      shelf,
      books: items.sort((a, b) => (order === 'date' ? byDate(a, b) : byShelf(a, b)) || title(a).localeCompare(title(b))).map(({ entry }) => ({
        author: entry.authorLine, title: entry.edition.subtitle ? `${entry.edition.title}: ${entry.edition.subtitle}` : entry.edition.title,
        date: dateOf(entry), year: entry.edition.year || null,
      })),
    }));
}

const escapeHtml = text => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The lists as a page for paper: one table per shelf, with the date it was printed. */
export function shelfListsHtml(lists, { place, order, today }) {
  const tables = lists.map(({ shelf, books }) => `<section><h2>${escapeHtml(shelf)} <span>${books.length} ${books.length === 1 ? 'book' : 'books'}</span></h2>
<table><thead><tr><th>#</th><th>Author</th><th>Title</th><th>Written</th><th>Edition</th></tr></thead><tbody>
${books.map((book, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(book.author)}</td><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.date)}</td><td>${escapeHtml(book.year || '')}</td></tr>`).join('\n')}
</tbody></table></section>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Shelf lists: ${escapeHtml(place.join(SEPARATOR))}</title>
<link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/print.css"></head>
<body><main>
<h1>${escapeHtml(place.join(SEPARATOR))}</h1>
<p class="meta">${order === 'date' ? 'Each shelf by original date' : 'Each shelf in its order along the shelf'} · printed ${escapeHtml(today)} from My Loci Library</p>
${tables || '<p>No books stand there.</p>'}
<p class="screen-only"><button type="button" onclick="window.print()">Print</button></p>
</main></body></html>
`;
}
