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

// Catalog text sometimes carries doubled spaces ("The  cost of discipleship").
const tidy = text => String(text || '').replace(/\s+/g, ' ').trim();

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
  found.title = titleCase(tidy(book.title));
  found.subtitle = titleCase(tidy(book.subtitle));
  found.authors = (book.authors || []).map(author => tidy(author.name)).filter(Boolean);
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
  found.title = titleCase(tidy(volume.title));
  found.subtitle = titleCase(tidy(volume.subtitle));
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
 * The Open Library searches for what a person typed, as query texts. The
 * first is the text as typed. People often add a publisher or series ("anna
 * karenina everyman's library", "complete works plato hackett"), words that
 * are in no title and push the right book out of the results; so the last
 * word, and the last two, are also tried as the publisher, which also brings
 * that publisher's edition to the top.
 * @returns {string[]}
 */
export function searchQueries(text) {
  // Little words (of, the, and…) are left out: Open Library requires every word
  // it is given, and "complete works of plato" would miss a book titled "Complete works".
  const all = String(text || '').trim().split(/\s+/).filter(Boolean);
  const kept = all.filter(word => !IGNORED_IN_SEARCH.has(word.toLowerCase()));
  const words = kept.length ? kept : all;
  const queries = [words.join(' ')];
  const stem = word => word.toLowerCase().replace(/[’']s$/, '').replace(/[^\p{L}\p{N}]/gu, '');
  for (const count of [1, 2]) {
    if (words.length - count < 2) continue;
    const publisher = words.slice(-count).map(stem).filter(word => word.length > 2 && !['library', 'press', 'books', 'classics', 'edition'].includes(word));
    if (publisher.length) queries.push(`${words.slice(0, -count).join(' ')} publisher:(${publisher.map(word => `${word}*`).join(' ')})`);
  }
  return [...new Set(queries)];
}

// A name in Latin letters, from the forms Open Library knows: "Plato" rather than "Πλάτων".
const latin = text => /^[\p{Script=Latin}\p{N}\s.,'’()-]+$/u.test(text);
function nameInLatin(name, others) {
  if (latin(name)) return name;
  const usable = (others || []).filter(other => latin(other) && other.trim().length > 2);
  // The form written as a person would ("Plato"), before one in capitals ("PLATO").
  return usable.find(other => other !== other.toUpperCase()) || usable[0] || name;
}

// The words of a search that should be found in a result, plain and lowercase.
const IGNORED_IN_SEARCH = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'to', 'for', 'by', 'with']);
const searchWords = text => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[’']s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter(word => word && !IGNORED_IN_SEARCH.has(word));

/**
 * Read Open Library's search answers (/search.json, with each work's best
 * matching edition) into one list of candidates, each a specific edition: its
 * own title (in English when there is one), the author in Latin letters, its
 * publisher, year, ISBN and cover. Works found by more than one search appear
 * once. With the text that was typed, the list is ordered by how many of its
 * words each candidate's title, authors and publisher hold, so "complete works
 * plato hackett" puts Hackett's Complete Works of Plato first.
 * @param {object[]} answers in order of preference
 * @param {string} [text] what was typed
 * @returns {{ title: string, authors: string[], publisher: string, year: string, isbn: string, cover: number|null }[]}
 */
export function candidatesFromSearch(answers, text = '') {
  if (!Array.isArray(answers)) answers = [answers];
  const seen = new Set();
  const candidates = [];
  for (const answer of answers) {
    for (const doc of (answer && answer.docs) || []) {
      if (seen.has(doc.key || doc.title)) continue;
      seen.add(doc.key || doc.title);
      const edition = (doc.editions && doc.editions.docs && doc.editions.docs[0]) || {};
      const isbns = edition.isbn || doc.isbn || [];
      candidates.push({
        title: edition.title || (doc.title + (doc.subtitle ? `: ${doc.subtitle}` : '')),
        authors: (doc.author_name || []).map(name => nameInLatin(name, doc.author_alternative_name)),
        publisher: (edition.publisher || [])[0] || '',
        year: String(yearFromText((edition.publish_date || [])[0]) || doc.first_publish_year || ''),
        isbn: isbns.find(code => code.length === 13) || isbns[0] || '',
        cover: edition.cover_i || doc.cover_i || null, // Open Library's number for the cover picture
      });
    }
  }
  const wanted = searchWords(text);
  if (!wanted.length) return candidates.slice(0, 10);
  const score = candidate => {
    const has = new Set(searchWords([candidate.title, ...candidate.authors, candidate.publisher].join(' ')));
    return wanted.filter(word => has.has(word)).length;
  };
  // A stable sort: among equal scores, Open Library's own order stays.
  return candidates.map((candidate, i) => ({ candidate, i, score: score(candidate) }))
    .sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 10).map(item => item.candidate);
}

/**
 * A year from a date as Open Library writes it: "13 November 354" is 354,
 * "1522" is 1522, "c. 350 BC" is -350.
 * @returns {number|null}
 */
export function yearFromText(text) {
  const match = String(text || '').match(/(\d{1,4})\s*(BC|B\.C\.|BCE)?\s*$/i) || String(text || '').match(/(\d{3,4})/);
  if (!match) return null;
  return match[2] ? -Number(match[1]) : Number(match[1]);
}

/**
 * What Open Library knows about the work behind an ISBN, from its search
 * answer (/search.json?q=isbn:...) and the first author's record (/authors/<key>.json).
 * @returns {{ workTitle: string, firstPublished: number|null, author: { name: string, born: number|null, died: number|null } | null }}
 */
export function workFromOpenLibrary(searchAnswer, authorAnswer) {
  const doc = (searchAnswer && searchAnswer.docs && searchAnswer.docs[0]) || {};
  const author = authorAnswer && authorAnswer.name
    ? { name: authorAnswer.name, born: yearFromText(authorAnswer.birth_date), died: yearFromText(authorAnswer.death_date) }
    : null;
  return { workTitle: doc.title || '', firstPublished: doc.first_publish_year || null, author };
}

/**
 * Suggestions for a work's original date, for a person to accept with one
 * tap; never filled in by themselves (PLAN.md, "Original dates"). Reasoning:
 * Open Library's earliest edition of a work is often its first publication,
 * but for older works it is only an early printing; an author's lifetime
 * bounds when the work was written.
 * @param {{ firstPublished: number|null, author: object|null }} work from workFromOpenLibrary
 * @param {number|null} editionYear the year of the edition in hand
 * @returns {{ text: string, label: string }[]} most likely first
 */
export function suggestOriginalDates(work, editionYear) {
  const suggestions = [];
  const { firstPublished, author } = work;
  const lifetime = author && author.died !== null
    ? { text: author.born !== null ? lifeText(author.born, author.died) : `before ${yearText(author.died)}`, label: `written in ${author.name}'s lifetime` }
    : null;
  if (firstPublished !== null && lifetime && firstPublished > author.died) {
    // The earliest edition came after the author's death: it is a printing, not the original.
    suggestions.push({ ...lifetime, label: `${lifetime.label}; Open Library's earliest edition (${firstPublished}) is a later printing` });
    return suggestions;
  }
  if (firstPublished !== null) {
    const same = editionYear && Number(editionYear) === firstPublished;
    suggestions.push({ text: String(firstPublished), label: same ? 'first published, the same year as this printing (Open Library): check it is not an older work' : 'first published (Open Library)' });
  }
  if (lifetime) suggestions.push(lifetime);
  return suggestions;
}

const yearText = year => (year < 0 ? `${-year} BC` : String(year));
const lifeText = (born, died) => (born < 0 && died < 0 ? `${-born}–${-died} BC` : born < 0 ? `${-born} BC – ${died}` : `${born}–${died}`);

// Small words stay lower case inside a title (Chicago style).
const SMALL_WORDS = new Set(['a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in', 'of', 'on', 'to', 'up', 'via', 'with', 'from', 'into', 'over']);

/**
 * Title case for a title written all in lower case ("The cost of
 * discipleship" becomes "The Cost of Discipleship"). A title that already
 * has capitals inside it is left exactly as it is, since its capitals were
 * chosen by someone ("Greek New Testament: UBS5", "iPhone").
 */
export function titleCase(text) {
  const words = String(text || '').split(' ');
  if (words.slice(1).some(word => /[A-Z]/.test(word))) return text;
  return words.map((word, i) => {
    const afterColon = i > 0 && /[:—]$/.test(words[i - 1]);
    const keepSmall = i > 0 && i < words.length - 1 && !afterColon && SMALL_WORDS.has(word.toLowerCase());
    return keepSmall ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}
