// The library as the screens see it: one entry per edition, with its works,
// authors, copies and everything needed to sort, filter and search it,
// worked out once when the records are loaded.

import { sortYearOf } from './dating.js';
import { anthologyRange } from './anthology.js';
import { searchTextOf, normalizeForSearch } from './search.js';

/**
 * Build the library from all records.
 * @param {object[]} records every record, of every type
 * @param {{ searchText?: boolean }} [options] searchText: false leaves the
 *   search text out, so the first screen appears sooner; add it afterwards
 *   with withSearchText (searching works either way).
 * @returns {{ entries: object[], worksById: Map, authorsById: Map, editionsById: Map, wishlist: { item: object, searchText: string }[] }}
 */
export function buildLibrary(records, { searchText = true } = {}) {
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
    entries.push(entryOf(edition, copiesByEdition.get(edition.id) || [], worksById, authorsById, searchText));
  }
  // Wishlist items get their own search text, kept beside the record.
  const wishes = wishlist.map(item => ({
    item,
    searchText: normalizeForSearch([item.title, item.subtitle, ...item.authors, item.publisher, item.isbn, item.notes].filter(Boolean).join(' ')),
  }));
  return { entries, worksById, authorsById, editionsById, wishlist: wishes };
}

/** One edition with what the screens need, worked out once. */
export function entryOf(edition, copies, worksById, authorsById, withSearch = true) {
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
    categories: [...new Set(works.map(work => work.category).filter(Boolean))],
    tags: [...new Set(works.flatMap(work => work.tags))],
    needsDate: works.some(work => sortYearOf(work) === null),
    searchText: withSearch ? searchTextOf(edition, worksById, authorsById, copies) : null,
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

/** The library with every entry's search text filled in. Never changes its input. */
export function withSearchText(library) {
  const entries = library.entries.map(entry => (entry.searchText !== null ? entry
    : { ...entry, searchText: searchTextOf(entry.edition, library.worksById, library.authorsById, entry.copies) }));
  return { ...library, entries };
}

/** How an author sorts: their sort form, or their last name first. */
export function sortNameOf(author) {
  if (author.sortName) return author.sortName;
  const words = author.name.trim().split(/\s+/);
  return words.length > 1 ? `${words[words.length - 1]}, ${words.slice(0, -1).join(' ')}` : author.name;
}

// The ways the library can be sorted, each with a label for the screen and
// a key worked out once per book. Comparing ready-made keys is several times
// faster than comparing titles with the browser's language rules on every
// step of the sort. Books with no value for the chosen field go last.
const textKey = text => (text ? normalizeForSearch(text).replace(/\d+/g, digits => digits.padStart(6, '0')) : null);
export const SORTS = {
  title: { label: 'Title', key: entry => textKey(entry.edition.title.replace(/^(the|a|an) /i, '')) },
  subtitle: { label: 'Subtitle', key: entry => textKey(entry.edition.subtitle) },
  author: { label: 'Author', key: entry => textKey(entry.authorSort) },
  originalDate: { label: 'Original date', key: entry => entry.sortYear },
  year: { label: 'Edition year', key: entry => entry.edition.year },
  added: { label: 'Date added', key: entry => entry.added || null, descending: true },
  value: { label: 'Value', key: entry => entry.value || null, descending: true },
  location: { label: 'Location', key: entry => textKey(entry.location.join(' ')) },
  binding: { label: 'Binding', key: entry => textKey(entry.binding) },
  category: { label: 'Category', key: entry => textKey(entry.categories[0]) },
  publisher: { label: 'Publisher', key: entry => textKey(entry.edition.publisher) },
  pages: { label: 'Pages', key: entry => entry.edition.pages },
  series: { label: 'Series', key: entry => textKey([entry.edition.series || entry.edition.set, entry.edition.seriesNumber || entry.edition.volume].filter(Boolean).join(' ')) },
};

function compareKeys(x, y, descending) {
  if (x === y) return 0;
  if (x === null || y === null) return x === null ? 1 : -1;
  return (x < y ? -1 : 1) * (descending ? -1 : 1);
}

/**
 * Entries in the order of a sort, ties broken by title. Never changes its input.
 * @param {object[]} entries
 * @param {string} sort a key of SORTS
 */
export function sortEntries(entries, sort) {
  const order = SORTS[sort] || SORTS.title;
  const keyed = entries.map(entry => ({ entry, key: order.key(entry), title: SORTS.title.key(entry) }));
  keyed.sort((a, b) => compareKeys(a.key, b.key, order.descending) || compareKeys(a.title, b.title, false));
  return keyed.map(item => item.entry);
}

// A view: which books to show and in what order. Saved views (PLAN.md,
// "Saved views") are these same objects with a name.
export const VIEW_DEFAULTS = { medium: 'physical', sort: 'title', status: 'owned', location: [], category: '', tag: '', needsDate: false };

/** Whether a location lies at or inside another (["Home", "Office"] is inside ["Home"]). */
export const isInside = (location, outer) => outer.every((part, i) => location[i] === part);

function matchesStatus(entry, status) {
  if (status === 'owned') return entry.owned;
  if (status === 'gone') return !entry.owned;
  return status === 'all' || entry.copies.some(copy => copy.status === status);
}

/**
 * The entries a view shows, in its order. Never changes its input.
 * @param {object[]} entries
 * @param {Partial<typeof VIEW_DEFAULTS>} view status: 'owned', 'gone', 'all' or one
 *   copy status; location: a path, matching books there or further inside
 */
export function viewEntries(entries, view = {}) {
  const { medium, sort, status, location, category, tag, needsDate } = { ...VIEW_DEFAULTS, ...view };
  return sortEntries(entries.filter(entry => (medium === 'all' || entry.edition.medium === medium)
    && matchesStatus(entry, status)
    && (!location.length || entry.copies.some(copy => isInside(copy.location, location)))
    && (!category || entry.categories.includes(category))
    && (!tag || entry.tags.includes(tag))
    && (!needsDate || entry.needsDate)), sort);
}

/** What the filters can offer: every location (and each place containing one), category and tag in use. */
export function filterChoices(entries) {
  const locations = new Map();
  const categories = new Set();
  const tags = new Set();
  for (const entry of entries) {
    for (const copy of entry.copies) {
      // Empty parts (a shelf left blank) are not offered as places of their own.
      for (let depth = 1; depth <= copy.location.length && copy.location[depth - 1]; depth++) {
        const path = copy.location.slice(0, depth);
        locations.set(JSON.stringify(path), path);
      }
    }
    entry.categories.forEach(category => categories.add(category));
    entry.tags.forEach(tag => tags.add(tag));
  }
  const byText = (a, b) => a.localeCompare(b);
  return {
    locations: [...locations.values()].sort((a, b) => byText(a.join(' › '), b.join(' › '))),
    categories: [...categories].sort(byText),
    tags: [...tags].sort(byText),
  };
}

/**
 * Search every edition, owned or not, physical and Logos. Results come back
 * grouped by work, so several editions of one work sit together.
 * @returns {object[]} matching entries, at most `limit`
 */
export function searchEntries(library, query, limit = 50) {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const found = [];
  for (const entry of library.entries) {
    const text = entry.searchText ?? searchTextOf(entry.edition, library.worksById, library.authorsById, entry.copies);
    if (words.every(word => text.includes(word))) {
      found.push(entry);
      if (found.length >= limit) break;
    }
  }
  // Editions of one work sit together: order by the first work's title, then its ID.
  const firstWork = entry => (entry.works[0] ? `${textKey(entry.works[0].title)} ${entry.works[0].id}` : textKey(entry.edition.title));
  const keyed = found.map(entry => ({ entry, key: firstWork(entry), title: SORTS.title.key(entry) }));
  keyed.sort((a, b) => compareKeys(a.key, b.key, false) || compareKeys(a.title, b.title, false));
  return keyed.map(item => item.entry);
}
