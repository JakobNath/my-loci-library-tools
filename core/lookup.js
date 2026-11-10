// Turning Open Library and Google Books answers into our fields. The
// lookups themselves happen in edges/lookup-openlibrary.js and
// edges/lookup-googlebooks.js; this file only reads their answers, so it can
// be tested with recorded ones. Original dates are never taken from a
// lookup (PLAN.md, "Original dates"): online dates are of an edition, not of
// when a work was written.

/**
 * The shape every lookup is turned into. Empty values are '' or [].
 * @typedef {{ title: string, subtitle: string, authors: string[], contributors: { name: string, role: string }[],
 *   publisher: string, place: string, year: string, pages: string, languages: string[], isbn: string,
 *   cover: { url: string, source: string, waiting: boolean } | null, source: string }} Found
 */
function emptyFound(source) {
  return { title: '', subtitle: '', authors: [], contributors: [], publisher: '', place: '', year: '', pages: '', languages: [], isbn: '', cover: null, source };
}

const yearOf = text => (String(text || '').match(/\b(1[4-9]\d\d|20\d\d)\b/) || [''])[0];

// "xxviii, 311 p. ;" is written as "xxviii, 311". Library records made before
// printing say "pages cm" (no count yet), which gives nothing.
function cleanPages(text) {
  const pages = String(text || '').replace(/\s*\bp(?:p|ages)?\.?/gi, '').replace(/\bcm\b/gi, '').replace(/[\s;:,.]+$/, '').trim();
  return /\d|^[ivxlc]+$/i.test(pages) ? pages : '';
}

// People named in a "by" line: "Saint Augustine ; translated by Henry Chadwick."
function contributorsFrom(byLine) {
  const people = [];
  // A name runs to the next ";" or ","; full stops stay, since names have initials (F. J. Sheed).
  const roles = [['translator', /translated\s+(?:and\s+\w+\s+)?by\s+([^;,]+)/i], ['editor', /edited\s+(?:and\s+\w+\s+)?by\s+([^;,]+)/i],
    ['introduction', /introduction\s+(?:and\s+\w+\s+)?by\s+([^;,]+)/i], ['illustrator', /illustrated\s+by\s+([^;,]+)/i]];
  for (const [role, pattern] of roles) {
    const match = String(byLine || '').match(pattern);
    if (!match) continue;
    for (const name of match[1].split(/\s+and\s+/)) {
      const clean = name.trim().replace(/\.$/, (dot, at, whole) => (/[A-Z]\.$/.test(whole) ? dot : ''));
      if (clean) people.push({ name: clean, role });
    }
  }
  return people;
}

/**
 * Read Open Library's answer to /api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=data.
 * @param {object} answer the whole answer
 * @param {string} isbn the 13-digit ISBN asked for
 * @param {string} coverUrl where Open Library keeps this ISBN's cover (given by the edge)
 * @returns {Found|null} null when Open Library does not know the book
 */
export function fromOpenLibrary(answer, isbn, coverUrl) {
  const book = answer && answer[`ISBN:${isbn}`];
  if (!book || !book.title) return null;
  const found = emptyFound('openlibrary');
  found.title = book.title;
  found.subtitle = book.subtitle || '';
  found.authors = (book.authors || []).map(author => author.name).filter(Boolean);
  found.contributors = contributorsFrom(book.by_statement);
  found.publisher = (book.publishers && book.publishers[0] && book.publishers[0].name) || '';
  found.place = (book.publish_places && book.publish_places[0] && book.publish_places[0].name) || '';
  found.year = yearOf(book.publish_date);
  found.pages = cleanPages(book.pagination) || (book.number_of_pages ? String(book.number_of_pages) : '');
  found.isbn = isbn;
  found.cover = coverUrl ? { url: coverUrl, source: 'openlibrary', waiting: false } : null;
  return found;
}

const LANGUAGES = { en: 'English', de: 'German', la: 'Latin', grc: 'Greek', el: 'Greek', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', he: 'Hebrew' };

/**
 * Read Google Books' answer to /books/v1/volumes?q=isbn:<isbn>.
 * Its cover pictures cannot be read by a web page, so a cover is marked as
 * waiting, for a laptop tool to fetch (HOW_IT_WORKS.md, "4.2").
 * @returns {Found|null}
 */
export function fromGoogleBooks(answer, isbn) {
  const volume = answer && answer.items && answer.items[0] && answer.items[0].volumeInfo;
  if (!volume || !volume.title) return null;
  const found = emptyFound('googlebooks');
  found.title = volume.title;
  found.subtitle = volume.subtitle || '';
  found.authors = volume.authors || [];
  found.publisher = volume.publisher || '';
  found.year = yearOf(volume.publishedDate);
  found.pages = volume.pageCount ? String(volume.pageCount) : '';
  found.languages = volume.language ? [LANGUAGES[volume.language] || volume.language] : [];
  found.isbn = isbn;
  const picture = volume.imageLinks && (volume.imageLinks.thumbnail || volume.imageLinks.smallThumbnail);
  if (picture) found.cover = { url: picture.replace(/^http:/, 'https:').replace('&edge=curl', ''), source: 'googlebooks', waiting: true };
  return found;
}

/**
 * Fill the gaps in one lookup with another (Open Library first, then Google Books).
 * @returns {Found|null}
 */
export function combineFound(first, second) {
  if (!first) return second;
  if (!second) return first;
  const combined = { ...first };
  for (const [name, value] of Object.entries(second)) {
    const mine = combined[name];
    const empty = mine === '' || mine === null || (Array.isArray(mine) && !mine.length);
    if (empty) combined[name] = value;
  }
  return combined;
}

/**
 * Read Open Library's search answer (/search.json) into a short list of
 * candidates to choose from, for a search by title.
 * @returns {{ title: string, authors: string[], year: string, isbn: string }[]}
 */
export function candidatesFromSearch(answer) {
  return ((answer && answer.docs) || []).slice(0, 10).map(doc => ({
    title: doc.title + (doc.subtitle ? `: ${doc.subtitle}` : ''),
    authors: doc.author_name || [],
    year: doc.first_publish_year ? String(doc.first_publish_year) : '',
    isbn: (doc.isbn || []).find(code => code.length === 13) || '',
  }));
}
