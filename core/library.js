// The library as the screens see it: one entry per edition, with its works,
// authors, copies and everything needed to sort, filter and search it,
// worked out once when the records are loaded.

import { sortYearOf } from './dating.js';
import { anthologyRange } from './anthology.js';
import { searchTextOf, normalizeForSearch } from './search.js';

/**
 * Build the library from all records.
 * @param {object[]} records every record, of every type
 * @returns {{ entries: object[], worksById: Map, authorsById: Map, editionsById: Map, wishlist: { item: object, searchText: string }[] }}
 */
export function buildLibrary(records) {
  const worksById = new Map();
  const authorsById = new Map();
  const editionsById = new Map();
  const copiesByEdition = new Map();
  const wishlist = [];
  for (const record of records) {
    if (record.trashed) continue;
    if (record.type === 'work') worksById.set(record.id, record);
    else if (record.type === 'author') authorsById.set(record.id, record);
    else if (record.type === 'edition') editionsById.set(record.id, record);
    else if (record.type === 'wishlist') wishlist.push(record);
    else if (record.type === 'copy') {
      if (!copiesByEdition.has(record.edition)) copiesByEdition.set(record.edition, []);
      copiesByEdition.get(record.edition).push(record);
    }
  }
  const entries = [];
  for (const edition of editionsById.values()) {
    entries.push(entryOf(edition, copiesByEdition.get(edition.id) || [], worksById, authorsById));
  }
  // Wishlist items get their own search text, kept beside the record.
  const wishes = wishlist.map(item => ({
    item,
    searchText: normalizeForSearch([item.title, item.subtitle, ...item.authors, item.publisher, item.isbn, item.notes].filter(Boolean).join(' ')),
  }));
  return { entries, worksById, authorsById, editionsById, wishlist: wishes };
}

/** One edition with what the screens need, worked out once. */
export function entryOf(edition, copies, worksById, authorsById) {
  const works = edition.contents.map(entry => worksById.get(entry.work)).filter(Boolean);
  const authorIds = [...new Set(works.flatMap(work => work.authors))];
  const authors = authorIds.map(id => authorsById.get(id)).filter(Boolean);
  const editors = edition.contributors.filter(person => person.role === 'editor').map(person => person.name);
  const range = works.length > 1 ? anthologyRange(edition, worksById) : null;
  const years = works.map(sortYearOf).filter(year => year !== null);
  const owned = copies.some(copy => copy.status === 'owned');
  return {
    id: edition.id,
    edition,
    copies,
    works,
    authors,
    authorLine: authorLineOf(works, authors, editors),
    authorSort: authors.length ? sortNameOf(authors[0]) : editors[0] || '',
    sortYear: years.length ? Math.min(...years) : null,
    range,
    owned,
    isDigital: edition.medium === 'logos',
    added: copies.map(copy => copy.added).sort()[0] || '',
    value: copies.filter(copy => copy.status === 'owned').reduce((sum, copy) => sum + (copy.value || 0), 0),
    location: (copies.find(copy => copy.location.length) || { location: [] }).location,
    binding: (copies.find(copy => copy.binding) || { binding: '' }).binding,
    searchText: searchTextOf(edition, worksById, authorsById, copies),
  };
}

/**
 * The author line (PLAN.md, "Anthologies"): a book's own authors; for an
 * anthology, the author every work shares (Plato), or else its editors.
 */
export function authorLineOf(works, authors, editors) {
  const names = authors.map(author => author.name);
  const shared = works.length > 1 ? works.every(work => work.authors.length === 1 && work.authors[0] === works[0].authors[0]) : true;
  if (names.length && shared) return names.length <= 2 ? names.join(' and ') : `${names[0]} and others`;
  if (editors.length) return `ed. ${editors.slice(0, 2).join(' and ')}${editors.length > 2 ? ' and others' : ''}`;
  return names.length ? `${names[0]} and others` : '';
}

/** How an author sorts: their sort form, or their last name first. */
export function sortNameOf(author) {
  if (author.sortName) return author.sortName;
  const words = author.name.trim().split(/\s+/);
  return words.length > 1 ? `${words[words.length - 1]}, ${words.slice(0, -1).join(' ')}` : author.name;
}

// The ways the library can be sorted, each with a label for the screen.
// Entries with no value for the chosen field always go last.
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byText = pick => (a, b) => collator.compare(pick(a), pick(b));
const byNumber = (pick, descending = false) => (a, b) => {
  const x = pick(a);
  const y = pick(b);
  if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
  return descending ? y - x : x - y;
};
const titleOf = entry => entry.edition.title.replace(/^(the|a|an) /i, '');
export const SORTS = {
  title: { label: 'Title', compare: byText(titleOf) },
  author: { label: 'Author', compare: byText(entry => entry.authorSort || '￿') },
  originalDate: { label: 'Original date', compare: byNumber(entry => entry.sortYear) },
  year: { label: 'Edition year', compare: byNumber(entry => entry.edition.year) },
  added: { label: 'Date added', compare: byText(entry => entry.added), descending: true },
  value: { label: 'Value', compare: byNumber(entry => entry.value || null, true) },
  location: { label: 'Location', compare: byText(entry => entry.location.join(' ') || '￿') },
  binding: { label: 'Binding', compare: byText(entry => entry.binding || '￿') },
  series: { label: 'Series', compare: byText(entry => `${entry.edition.series || entry.edition.set || '￿'} ${entry.edition.seriesNumber || entry.edition.volume || ''}`) },
};

/**
 * The entries to show, filtered and sorted. Never changes its input.
 * @param {object[]} entries
 * @param {{ medium?: 'physical'|'logos'|'all', sort?: string, showGone?: boolean }} view
 */
export function viewEntries(entries, { medium = 'physical', sort = 'title', showGone = false } = {}) {
  const chosen = entries.filter(entry => (medium === 'all' || entry.edition.medium === medium) && (showGone || entry.owned));
  const order = SORTS[sort] || SORTS.title;
  chosen.sort((a, b) => {
    const result = order.compare(a, b);
    return result === 0 ? SORTS.title.compare(a, b) : order.descending ? -result : result;
  });
  return chosen;
}

/**
 * Search every edition, owned or not, physical and Logos. Results come back
 * grouped by work, so several editions of one work sit together.
 * @returns {object[]} matching entries, at most `limit`
 */
export function searchEntries(entries, query, limit = 50) {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const found = [];
  for (const entry of entries) {
    if (words.every(word => entry.searchText.includes(word))) {
      found.push(entry);
      if (found.length >= limit) break;
    }
  }
  // Editions of one work sit together: order by the first work's title, then its ID.
  const firstWork = entry => (entry.works[0] ? `${entry.works[0].title} ${entry.works[0].id}` : entry.edition.title);
  return found.sort((a, b) => collator.compare(firstWork(a), firstWork(b)) || SORTS.title.compare(a, b));
}
