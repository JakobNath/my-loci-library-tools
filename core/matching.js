// Finding what the catalog already holds when a book is added: the same
// edition (a duplicate ISBN), and works that may be the same as the new
// book's (PLAN.md, "Batch add"). Nothing is ever linked automatically; these
// are only suggestions for a person to confirm.

import { normalizeForSearch } from './search.js';

// Titles compared without case, accents, punctuation or a leading article.
const titleKey = title => normalizeForSearch(title).replace(/^(the|a|an) /, '');

/**
 * Editions already in the catalog with this ISBN.
 * @param {string} isbn 13 digits
 * @param {object[]} entries library entries (core/library.js)
 */
export function editionsWithIsbn(isbn, entries) {
  return isbn ? entries.filter(entry => entry.edition.isbn === isbn) : [];
}

/**
 * Works that may be the same as a new book's: the same title (ignoring a
 * leading article), and, when both have authors, at least one author in
 * common under any form of their name.
 * @param {string} title
 * @param {string[]} authorNames names as found or typed
 * @param {{ worksById: Map, authorsById: Map }} library
 * @returns {object[]} work records
 */
export function suggestWorks(title, authorNames, library) {
  const key = titleKey(title);
  if (!key) return [];
  const names = new Set(authorNames.map(normalizeForSearch));
  const suggestions = [];
  for (const work of library.worksById.values()) {
    if (titleKey(work.title) !== key) continue;
    const forms = work.authors.flatMap(id => {
      const author = library.authorsById.get(id);
      return author ? [author.name, ...author.otherNames].map(normalizeForSearch) : [];
    });
    if (!names.size || !forms.length || forms.some(form => names.has(form))) suggestions.push(work);
  }
  return suggestions;
}

/**
 * "Possibly the same as…" (PLAN.md, "Anthologies"): works already in the
 * library that Wikidata names with the same item as a new work. They are only
 * offered: the new work's ID came from a search by its title, not from a
 * person, so nothing is joined until a person taps.
 * @param {Map<string, { wikidata: string }>} found Wikidata's answers, by the title asked
 * @param {Map<string, object>} worksById the library's works
 * @returns {Map<string, object>} the work already held, by the title asked
 */
export function sameWikidataWorks(found, worksById) {
  const held = new Map();
  for (const work of worksById.values()) if (work.wikidata && !work.trashed) held.set(work.wikidata, work);
  const same = new Map();
  for (const [title, answer] of found) if (answer && held.has(answer.wikidata)) same.set(title, held.get(answer.wikidata));
  return same;
}
