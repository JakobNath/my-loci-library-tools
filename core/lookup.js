// Turning Open Library and Google Books answers into our fields. The
// lookups themselves happen in edges/lookup-openlibrary.js and
// edges/lookup-googlebooks.js; this file only reads their answers, so it can
// be tested with recorded ones. Original dates are never taken from a
// lookup (PLAN.md, "Original dates"): online dates are of an edition, not of
// when a work was written.

import { normalizeForSearch } from './search.js';

/**
 * The shape every lookup is turned into. Empty values are '', null or [].
 * height and thickness are in millimeters. contents lists an anthology's
 * works as a record gives them ({ title, author }). identifiers are the
 * catalogue numbers of DATA_FORMAT.md (lccn, oclc, lcc, ddc). set and volume
 * are given when a library record describes the book as one volume of a set.
 * @typedef {{ title: string, subtitle: string, authors: string[], contributors: { name: string, role: string }[],
 *   publisher: string, place: string, year: string, pages: string, languages: string[], isbn: string,
 *   editionStatement: string, series: string, seriesNumber: string, height: number|null, thickness: number|null,
 *   binding: string, originalTitle: string, originalLanguage: string, contents: { title: string, author: string }[],
 *   subjects: string[], identifiers: { lccn: string, oclc: string, lcc: string, ddc: string, openLibrary: string, hathiTrust: string },
 *   cover: { url: string, source: string, waiting: boolean } | null, set: string, volume: string, source: string }} Found
 */
export function emptyFound(source) {
  return {
    title: '', subtitle: '', authors: [], contributors: [], publisher: '', place: '', year: '', pages: '', languages: [], isbn: '',
    editionStatement: '', series: '', seriesNumber: '', height: null, thickness: null, binding: '', originalTitle: '', originalLanguage: '',
    contents: [], subjects: [], identifiers: { lccn: '', oclc: '', lcc: '', ddc: '', openLibrary: '', hathiTrust: '' }, cover: null, set: '', volume: '', source,
  };
}

/** Catalog text without doubled spaces ("The  cost of discipleship"). */
export const tidy = text => String(text || '').replace(/\s+/g, ' ').trim();

// The words of a name, for comparing "Luther, Martin" with "Martin Luther".
const nameWords = name => normalizeForSearch(name).split(' ').filter(word => word.length > 1);

/**
 * Whether two names are written for the same person: every word of the
 * shorter is in the longer ("Martin Luther" and "Luther, Martin"; "Augustine"
 * and "Augustine of Hippo").
 */
export function samePerson(a, b) {
  const [short, long] = [nameWords(a), nameWords(b)].sort((x, y) => x.length - y.length);
  return short.length > 0 && short.every(word => long.includes(word));
}

/** The year in a publication date ("c1997.", "April 23, 1992"), as text. */
export const yearOf = text => (String(text || '').match(/(?<!\d)(1[4-9]\d\d|20\d\d)(?!\d)/) || [''])[0];

/**
 * Pages as printed: "xxviii, 311 p. ;" is "xxviii, 311". Library records made
 * before printing say "pages cm" (no count yet), and a set is described by its
 * volumes ("v. <1-3>", "2 v."); both give nothing.
 */
export function cleanPages(text) {
  const pages = String(text || '').replace(/\s*\bp(?:p|ages)?\.?/gi, '').replace(/\bcm\b/gi, '').replace(/[\s;:,.]+$/, '').trim();
  if (/^\d+\s+v$/i.test(pages)) return ''; // "2 v." is two volumes, not pages
  return /\d|^[ivxlc]+$/i.test(pages) && /^[\divxlcdm[\]\s,–-]+$/i.test(pages) ? pages : '';
}

// The roles named before "by": someone who "translated, with an introduction"
// is the translator (the introduction is part of that work); an associate or
// series editor is not the book's editor.
function rolesIn(words) {
  const text = words.toLowerCase();
  if (/\b(associate|assistant|general|series)\s+editor/.test(text)) return ['other'];
  const main = [['translat', 'translator'], ['edit', 'editor'], ['illustrat', 'illustrator']]
    .filter(([stem]) => text.includes(stem)).map(([, role]) => role);
  if (main.length) return main;
  return text.includes('introduc') ? ['introduction'] : [];
}

// "Robert Kolb and Timothy J. Wengert", "Charles Arand ... [et al.]". Full
// stops after initials stay (F. J. Sheed).
function namesIn(text) {
  return text.replace(/\.\.\.|\[?et al\.?\]?/g, '').split(/\s+and\s+|\s*,\s+|\s+&\s+/)
    .map(name => name.trim().replace(/[\s.;,]+$/, (end, at, whole) => (/[A-Z]\.$/.test(whole.trim()) ? '.' : '')))
    .filter(name => /\p{L}{2}/u.test(name));
}

/**
 * People named in a statement of responsibility (a "by" line):
 * "Saint Augustine ; translated by Henry Chadwick." Each part between ";"
 * is read on its own: the words before "by" give the roles, the names after
 * it the people. "associate editor, D.S. Hutchinson" has no "by" and is read too.
 * @returns {{ name: string, role: string }[]}
 */
export function contributorsFrom(byLine) {
  const people = [];
  for (const part of String(byLine || '').split(';')) {
    const at = part.search(/\bby\s/i);
    const named = at >= 0 ? [part.slice(0, at), part.slice(at + 3)]
      : (part.match(/^\s*([\p{L}\s]*?(?:editor|translator|illustrator)s?),\s+(.+)$/iu) || []).slice(1);
    if (named.length < 2) continue;
    const roles = rolesIn(named[0]);
    for (const name of roles.length ? namesIn(named[1]) : []) {
      for (const role of roles) people.push({ name, role });
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
  const item = googleBooksItem(answer, isbn);
  const volume = item && item.volumeInfo;
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

/** Whether a Google Books volume lists this ISBN (as ISBN-13 or ISBN-10). */
export function listsIsbn(volumeInfo, isbn) {
  return ((volumeInfo && volumeInfo.industryIdentifiers) || []).some(code => code.identifier === isbn || code.identifier === isbn.slice(3, 12) + isbn10Check(isbn));
}

const isbn10Check = isbn => {
  const sum = [...isbn.slice(3, 12)].reduce((total, digit, i) => total + Number(digit) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
};

/**
 * The volume in a Google Books search answer that lists this ISBN. A search
 * by ISBN also returns library scans without one, and now and then another
 * book carrying the same ISBN, so the first volume listing it is taken.
 * @returns {object|null} the search item, with its `id` and `volumeInfo`
 */
export function googleBooksItem(answer, isbn) {
  return ((answer && answer.items) || []).find(item => listsIsbn(item.volumeInfo, isbn)) || null;
}

const isEmpty = value => value === '' || value === null || (Array.isArray(value) && !value.length);

/**
 * Fill the gaps in one lookup with another: each field is taken from the
 * first that has it, and each catalogue number on its own.
 * @returns {Found|null}
 */
export function combineFound(first, second) {
  if (!first) return second;
  if (!second) return first;
  const combined = { ...first };
  for (const [name, value] of Object.entries(second)) {
    if (isEmpty(combined[name])) combined[name] = value;
  }
  if (first.identifiers && second.identifiers) {
    combined.identifiers = Object.fromEntries(Object.entries(first.identifiers).map(([name, value]) => [name, value || second.identifiers[name] || '']));
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
export const latin = text => /^[\p{Script=Latin}\p{N}\s.,'’()-]+$/u.test(text);

/**
 * A name in Latin letters, from the other forms Open Library knows for it.
 * A form already used in our library wins. Otherwise the plain form (no
 * accents, no dates, not in capitals) that most of the other forms contain:
 * "Homer" is inside "Homeros", "Homerus", "HOMER" and "Homer Staff", where
 * "Omero" is inside one, so Ὅμηρος becomes Homer, and Πλάτων becomes Plato.
 * @param {string} name as the record gives it
 * @param {string[]} [others] the other forms
 * @param {string[]} [known] author names already in the library
 * @returns {string}
 */
export function nameInLatin(name, others, known = []) {
  if (latin(name)) return name;
  const forms = (others || []).map(other => tidy(other)).filter(Boolean);
  const knownForm = forms.find(form => known.some(knownName => knownName.toLowerCase() === form.toLowerCase()));
  if (knownForm) return known.find(knownName => knownName.toLowerCase() === knownForm.toLowerCase());
  const plain = forms.filter(form => /^[A-Za-z][A-Za-z .'-]+$/.test(form) && form !== form.toUpperCase() && form.length > 2);
  if (plain.length) {
    const lower = forms.map(form => form.toLowerCase());
    const score = form => lower.filter(other => other.includes(form.toLowerCase())).length;
    return plain.map((form, i) => ({ form, i, score: score(form) }))
      .sort((a, b) => b.score - a.score || a.form.length - b.form.length || a.i - b.i)[0].form;
  }
  const usable = forms.filter(other => latin(other) && other.length > 2);
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
 * "1522" is 1522, "c. 350 BC" and "43 B. C." are negative, "1802-07-24" is
 * 1802, "17 A.D." is 17.
 * @returns {number|null}
 */
export function yearFromText(text) {
  const plain = String(text || '').trim();
  // A full date written year first (1802-07-24): the year is the first number, not the last.
  const iso = plain.match(/^(-?)(\d{1,4})-\d{1,2}(-\d{1,2})?$/);
  if (iso) return iso[1] ? -Number(iso[2]) : Number(iso[2]);
  // "6th century" names no year: its number is not one.
  if (/\d\s*(?:st|nd|rd|th)\b|\bcentur/i.test(plain)) return null;
  const numbers = plain.match(/\d{1,4}/g);
  if (!numbers) return null;
  // A day comes before its year ("24 July 1802"), so the last year-sized number wins; "17 or 18 A.D." keeps 18.
  const long = numbers.filter(number => number.length >= 3);
  const year = Number(long.length ? long[long.length - 1] : numbers[numbers.length - 1]);
  const isBC = /\bB\.?\s?C\.?/i.test(plain);
  return isBC ? -year : year;
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
 * The authors of the work behind an ISBN, from the same search answer, in
 * Latin letters ("Plato", not "Πλάτων"). Used when an edition record names
 * no authors of its own, as Open Library's record for Hackett's Plato does.
 * @returns {string[]}
 */
export function authorsFromWorkSearch(searchAnswer) {
  const doc = (searchAnswer && searchAnswer.docs && searchAnswer.docs[0]) || {};
  return (doc.author_name || []).map(name => nameInLatin(tidy(name), doc.author_alternative_name)).filter(Boolean);
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
export function suggestOriginalDates(work, editionYear, { authors = null, translated = false } = {}) {
  const suggestions = [];
  const { firstPublished } = work;
  // Open Library's work record sometimes names an editor or translator as the author
  // (Jaroslav Pelikan for Luther's Works): a lifetime is only offered for one of the book's own authors.
  const author = work.author && (!authors || !latin(work.author.name) || authors.some(name => samePerson(name, work.author.name))) ? work.author : null;
  const lifetime = author && author.died !== null
    ? { text: author.born !== null ? lifeText(author.born, author.died) : `before ${yearText(author.died)}`, label: `written in ${author.name}'s lifetime` }
    : null;
  if (firstPublished !== null && lifetime && firstPublished > author.died) {
    // The earliest edition came after the author's death: it is a printing, not the original.
    suggestions.push({ ...lifetime, label: `${lifetime.label}; Open Library's earliest edition (${firstPublished}) is a later printing` });
    return suggestions;
  }
  // A work printed by 1500 is older than printing in Europe (from the 1450s), so
  // that year is an early printing, never when the work was written (Ovid's Metamorphoses, 1479).
  if (firstPublished !== null && firstPublished > LAST_EARLY_PRINTING_YEAR) {
    const same = editionYear && Number(editionYear) === firstPublished;
    // With a translator and no lifetime to check it against, the year is often the translation's.
    const label = same ? 'first published, the same year as this printing (Open Library): check it is not an older work'
      : translated && !lifetime ? 'first published (Open Library); with a translator, this may be the translation\'s year' : 'first published (Open Library)';
    suggestions.push({ text: String(firstPublished), label });
  }
  if (lifetime) suggestions.push(lifetime);
  return suggestions;
}

const LAST_EARLY_PRINTING_YEAR = 1500; // the end of the incunable period, the first age of printing
const yearText = year =>(year < 0 ? `${-year} BC` : String(year));
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
  return sentenceToTitleCase(text);
}

/**
 * Title case for a title written in sentence case, as library catalogues
 * write them ("The letters of Ignatius" becomes "The Letters of Ignatius").
 * Words that already begin with a capital keep it.
 */
export function sentenceToTitleCase(text) {
  const words = String(text || '').split(' ');
  return words.map((word, i) => {
    const afterColon = i > 0 && /[:—]$/.test(words[i - 1]);
    const keepSmall = i > 0 && i < words.length - 1 && !afterColon && SMALL_WORDS.has(word.toLowerCase());
    return keepSmall ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}
