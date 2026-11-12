// The library as the screens see it: one entry per edition, with its works,
// authors, copies and everything needed to sort, filter and search it,
// worked out once when the records are loaded.

import { sortYearOf } from './dating.js';
import { anthologyRange } from './anthology.js';
import { searchTextOf, piecesTextOf, normalizeForSearch } from './search.js';

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
    piecesText: withSearch ? piecesTextOf(edition) : null,
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
    : { ...entry, searchText: searchTextOf(entry.edition, library.worksById, library.authorsById, entry.copies), piecesText: piecesTextOf(entry.edition) }));
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
export const VIEW_DEFAULTS = { medium: 'physical', sort: 'title', status: 'owned', location: [], category: '', tag: '', needsDate: false, needsDetails: false };

/**
 * The catalog details a physical book still lacks ("Needs details"): adding
 * asks only what a person knows, and these are left to the lookups and the
 * laptop's nightly check. A Logos book's details come from the Logos export,
 * so it never needs them here.
 * @returns {string[]} the names of the empty ones, of publisher, year, pages and binding
 */
export function missingDetails(entry) {
  if (entry.isDigital) return [];
  const { publisher, year, pages } = entry.edition;
  return Object.entries({ publisher, year, pages, binding: entry.binding }).filter(([, value]) => !value).map(([name]) => name);
}

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
 * @param {{ anthologies?: 'once'|'each' }} [options] anthologies: sorted by
 *   original date, an anthology shows once at its earliest date, or once under
 *   each work it holds (settings.json, "anthologiesInShelfLists")
 */
export function viewEntries(entries, view = {}, { anthologies = 'once' } = {}) {
  const { medium, sort, status, location, category, tag, needsDate, needsDetails } = { ...VIEW_DEFAULTS, ...view };
  const chosen = entries.filter(entry => (medium === 'all' || entry.edition.medium === medium)
    && matchesStatus(entry, status)
    && (!location.length || entry.copies.some(copy => isInside(copy.location, location)))
    && (!category || entry.categories.includes(category))
    && (!tag || entry.tags.includes(tag))
    && (!needsDate || entry.needsDate)
    && (!needsDetails || missingDetails(entry).length));
  if (sort !== 'originalDate' || anthologies !== 'each') return sortEntries(chosen, sort);
  return sortEntries(chosen.flatMap(entry => (entry.works.length > 1
    ? [...new Set(entry.works.map(sortYearOf))].map(year => ({ ...entry, sortYear: year }))
    : [entry])), sort);
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

/**
 * The pieces inside books (poems, hymns, sermons, letters) whose title, author
 * or original title holds every word typed: the folded "Also inside" line
 * under search results (PLAN.md, "Search").
 * @returns {{ entry: object, piece: object }[]} at most `limit`, in library order
 */
export function searchPieces(library, query, limit = 50) {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  const found = [];
  if (!words.length) return found;
  for (const entry of library.entries) {
    for (const { index, text } of entry.piecesText ?? piecesTextOf(entry.edition)) {
      if (!words.every(word => text.includes(word))) continue;
      found.push({ entry, piece: entry.edition.contents[index].piece });
      if (found.length >= limit) return found;
    }
  }
  return found;
}

/**
 * The books holding a work's text in its original language, not only a
 * translation: the "original-text marker" (PLAN.md, "Library and Wishlist
 * views"). An edition's languages list says what is printed in it; "Greek"
 * there matches a work first written in "Ancient Greek". Nothing is stored.
 * @returns {object[]} library entries, in library order
 */
export function originalTextHolders(work, library) {
  const original = normalizeForSearch(work.originalLanguage || '');
  const printsIt = language => { const printed = normalizeForSearch(language); return printed === original || original.endsWith(` ${printed}`); };
  return original ? library.entries.filter(entry => entry.works.includes(work) && entry.edition.languages.some(printsIt)) : [];
}
