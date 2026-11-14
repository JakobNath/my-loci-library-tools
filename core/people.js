// Who wrote a book, as far as the lookups can tell. Records found by ISBN
// often list a translator, an editor, a foreword writer or even the publisher
// among the authors, and name ancient authors in their own script. A person
// then sees "by A. D. Melville" or "by Emily Wilson and Ὅμηρος", and a wrong
// original date follows from it. These rules put the people the records do
// make clear in their right place; what the records get wrong without a trace
// is left for "Fix details" (docs/decisions/book-data.md, "People in lookups").

import { normalizeForSearch } from './search.js';
import { latin, nameInLatin, samePerson, tidy } from './lookup.js';

// A publisher's name without the words every publisher has: "Vandenhoeck & Ruprecht." is "vandenhoeck ruprecht".
const COMPANY_WORDS = new Set(['and', 'verlag', 'verlage', 'press', 'publishing', 'publishers', 'house', 'inc', 'ltd', 'co', 'gmbh', 'books']);
const companyKey = name => normalizeForSearch(name).split(' ').filter(word => word && !COMPANY_WORDS.has(word)).join(' ');

/**
 * The names typed in a translator box: separated by ";", or by "and" or "&"
 * between two names ("Pevear and Volokhonsky"), as people write them.
 * @param {string} text
 * @returns {string[]}
 */
export function translatorNames(text) {
  return String(text || '').split(/;|\s+(?:and|&)\s+/i).map(name => tidy(name)).filter(Boolean);
}

/**
 * The people of a looked-up book, set right where the records make it clear:
 * - someone the record names as translator, editor or the like is not also an author;
 * - an "author" that is the publisher is dropped;
 * - an author named in another script gets the Latin form (Ὅμηρος is Homer);
 * - an edition's author whom Open Library's work record does not list
 *   (Emily Wilson on Homer's Iliad) becomes a translator when the work is
 *   old (its author died more than a century before this printing, or was
 *   named in another script), and otherwise another contributor (a foreword).
 * @param {import('./lookup.js').Found} found the merged answer
 * @param {{ search?: object|null, work?: { author: { name: string, born: number|null, died: number|null }|null }|null, known?: string[] }} context
 *   search: Open Library's work search answer; work: from workFromOpenLibrary; known: author names in the library
 * @returns {import('./lookup.js').Found} a new object
 */
export function tidyPeople(found, { search = null, work = null, known = [] } = {}) {
  if (!found) return found;
  const doc = (search && search.docs && search.docs[0]) || {};
  const others = doc.author_alternative_name || [];
  const contributors = [...found.contributors];
  const named = contributors.filter(person => person.role !== 'author');
  const inOtherScript = found.authors.some(name => !latin(name)) || (doc.author_name || []).some(name => !latin(name));
  let authors = found.authors
    .map(name => nameInLatin(tidy(name), others, known))
    .filter(name => !named.some(person => samePerson(person.name, name)))
    .filter(name => !found.publisher || companyKey(name) !== companyKey(found.publisher));
  // The same person given twice (once in each script) is kept once.
  authors = authors.filter((name, i) => authors.findIndex(other => samePerson(other, name)) === i);
  const workAuthors = (doc.author_name || []).map(name => nameInLatin(tidy(name), others, known));
  const listed = name => workAuthors.some(author => samePerson(author, name));
  // Only when the work record shares at least one author with the edition is the rest moved aside.
  if (workAuthors.length && authors.some(listed) && !authors.every(listed)) {
    const author = work && work.author;
    const year = Number(found.year) || null;
    const old = inOtherScript || Boolean(author && year && ((author.died !== null && year - author.died > 100) || (author.born !== null && year - author.born > 200)));
    const hasTranslator = contributors.some(person => person.role === 'translator');
    for (const name of authors.filter(name => !listed(name))) contributors.push({ name, role: old && !hasTranslator ? 'translator' : 'other' });
    authors = authors.filter(listed);
  }
  return { ...found, authors, contributors };
}
