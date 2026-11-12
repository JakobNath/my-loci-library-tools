// The fuller book records of Open Library (the edition record) and Google
// Books (the volume record), and how the three sources are merged
// (PLAN.md, "Book data"). The Library of Congress is read in core/marc.js.
// Only answers are read here; the edges and the laptop tool fetch them.

import { isbn13 } from './entry.js';
import { emptyFound, combineFound, contributorsFrom, cleanPages, titleCase, tidy, yearOf, listsIsbn } from './lookup.js';

// MARC language codes (also used by Open Library) for the languages a library
// like ours meets. A code not listed is shown as it is.
export const LANGUAGE_NAMES = {
  ang: 'Old English', ara: 'Arabic', arc: 'Aramaic', arm: 'Armenian', chi: 'Chinese', chu: 'Church Slavic',
  cop: 'Coptic', cze: 'Czech', dan: 'Danish', dut: 'Dutch', eng: 'English', enm: 'Middle English',
  eth: 'Ethiopic', fin: 'Finnish', fre: 'French', frm: 'Middle French', fro: 'Old French', geo: 'Georgian',
  ger: 'German', gmh: 'Middle High German', grc: 'Ancient Greek', gre: 'Greek', heb: 'Hebrew',
  hun: 'Hungarian', ice: 'Icelandic', ita: 'Italian', jpn: 'Japanese', kor: 'Korean', lat: 'Latin',
  nor: 'Norwegian', per: 'Persian', pol: 'Polish', por: 'Portuguese', rus: 'Russian', san: 'Sanskrit',
  spa: 'Spanish', swe: 'Swedish', syr: 'Syriac',
};

// Open Library's physical formats, in the names of our binding list (core/settings.js).
const BINDINGS = [
  [/mass[\s-]*market/i, 'Mass-market paperback'], [/paper|soft/i, 'Paperback'], [/bonded/i, 'Bonded leather'],
  [/leather/i, 'Leather'], [/library/i, 'Library binding'], [/hard|cased/i, 'Hardcover'], [/cloth/i, 'Cloth'],
];

/** Our binding for a record's physical format ("Mass Market Paperback"), or '' when it names none we know. */
export function bindingFromFormat(text) {
  const match = BINDINGS.find(([pattern]) => pattern.test(String(text || '')));
  return match ? match[1] : '';
}

/**
 * Height and thickness in millimeters from dimensions written height first:
 * "8.4 x 5.4 x 1.8 inches", "22 x  x  centimeters". Sizes that cannot be a
 * single book's (a thickness not less than the width or half the height) are
 * not used at all: records sometimes give the three in another order
 * (Hackett's Plato: 24 × 9.5 × 16.1 cm), or measure a boxed set (the
 * Ante-Nicene Fathers: 14.1 × 10 × 8.5 inches).
 * @returns {{ height: number|null, thickness: number|null }}
 */
export function sizesFromDimensions(height, width, thickness, unit) {
  const scale = /in/i.test(unit) ? 25.4 : /mm/i.test(unit) ? 1 : 10;
  const mm = text => (Number(text) > 0 ? Math.round(Number(text) * scale) : null);
  const sizes = { height: mm(height), thickness: mm(thickness) };
  const tooThick = sizes.thickness && ((sizes.height && sizes.thickness >= sizes.height / 2) || (mm(width) && sizes.thickness >= mm(width)));
  return tooThick ? { height: null, thickness: null } : sizes;
}

// Front and back matter, and the volumes or parts of one book ("V. 1. Part I",
// "Part 1: Working with Biblical Hebrew Prose", "Books 1-12"), are not works.
const NOT_A_WORK = /^(preface|foreword|prologue|introduction|acknowledg|contents|index|bibliograph|notes|abbreviations|appendix|glossary|list of|further reading|chronology)|^(v|vols?|volumes?|pts?|parts?|bks?|books?|bd|band|teil)\.?\s*[\divxlc]+\b/i;

/** Whether a title in a contents list can be a work of an anthology. */
export const isWorkTitle = title => !NOT_A_WORK.test(tidy(title));

// The top level of Open Library's table of contents, as works an anthology may hold.
function contentsFromToc(toc) {
  const entries = (toc || []).filter(entry => entry && tidy(entry.title));
  const top = Math.min(...entries.map(entry => entry.level || 0));
  return entries.filter(entry => (entry.level || 0) === top && isWorkTitle(entry.title))
    .map(entry => {
      const title = tidy(entry.title).replace(/ : /g, ': ');
      return { title: titleCase(title === title.toUpperCase() ? title.toLowerCase() : title), author: tidy(entry.authors && entry.authors[0] && entry.authors[0].name) };
    });
}

// "Chemnitz's works -- v. 7, 8" and "Loeb classical library ; 36" give the series and its number.
function seriesParts(text) {
  const [name, number = ''] = tidy(text).split(/\s+--\s+|\s*;\s*/);
  return { series: titleCase(name.replace(/[.,]$/, '')), seriesNumber: number.replace(/^(?:v|vol|no)\.?\s*/i, '') };
}

// "John Bayley (Introduction)" names a role; "Chadwick, Henry, 1920-" does not.
function contributorsFromContributions(list) {
  const roles = { translator: 'translator', editor: 'editor', introduction: 'introduction', illustrator: 'illustrator' };
  return (list || []).map(text => String(text).match(/^(.+?)\s*\((\w+)\)$/)).filter(match => match && roles[match[2].toLowerCase()])
    .map(([, name, role]) => ({ name: tidy(name), role: roles[role.toLowerCase()] }));
}

const first = list => tidy((list || []).find(item => tidy(item)) || '');

/**
 * Read Open Library's full edition record (/isbn/<isbn>.json, after its redirect).
 * @param {object} edition the parsed record
 * @param {string} isbn 13 digits
 * @returns {import('./lookup.js').Found|null} null when the record does not list the ISBN
 */
export function fromOpenLibraryEdition(edition, isbn) {
  const isbns = [...((edition && edition.isbn_13) || []), ...((edition && edition.isbn_10) || [])].map(isbn13);
  if (!edition || !edition.title || !isbns.includes(isbn)) return null;
  const found = emptyFound('openlibrary');
  found.title = titleCase(tidy(edition.title));
  found.subtitle = titleCase(tidy(edition.subtitle));
  found.contributors = contributorsFrom(edition.by_statement);
  if (!found.contributors.length) found.contributors = contributorsFromContributions(edition.contributions);
  found.publisher = first(edition.publishers);
  found.place = first(edition.publish_places).replace(/[\s:;,]+$/, '');
  found.year = yearOf(edition.publish_date);
  found.pages = cleanPages(edition.pagination) || (edition.number_of_pages ? String(edition.number_of_pages) : '');
  found.isbn = isbn;
  // Records copied from booksellers say "New Ed edition", meaning "New ed.".
  found.editionStatement = tidy(edition.edition_name).replace(/[[\]]/g, '').replace(/\.\.$/, '.').replace(/\bEd\.? edition$/i, 'ed.');
  Object.assign(found, edition.series && edition.series.length ? seriesParts(edition.series[0]) : {});
  found.binding = bindingFromFormat(edition.physical_format);
  const dimensions = String(edition.physical_dimensions || '').match(/^\s*([\d.]*)\s*x\s*([\d.]*)\s*x\s*([\d.]*)\s*(\w+)/i);
  if (dimensions) Object.assign(found, sizesFromDimensions(...dimensions.slice(1)));
  found.originalTitle = tidy(edition.translation_of);
  const fromLanguage = ((edition.translated_from || [])[0] || {}).key;
  found.originalLanguage = fromLanguage ? LANGUAGE_NAMES[fromLanguage.split('/').pop()] || '' : '';
  found.contents = contentsFromToc(edition.table_of_contents);
  if (found.contents.length < 2) found.contents = [];
  found.subjects = (edition.subjects || []).map(tidy).filter(Boolean);
  found.identifiers = {
    lccn: first(edition.lccn), oclc: first(edition.oclc_numbers),
    lcc: first(edition.lc_classifications), ddc: first(edition.dewey_decimal_class).replace(/\//g, ''),
    openLibrary: tidy(edition.key).split('/').pop(), hathiTrust: '', // "/books/OL23154103M"
  };
  return found;
}

/**
 * Read Open Library's answer to /api/books?bibkeys=ISBN:<isbn>&format=json&jscmd=details:
 * the full edition record, with its authors' names, in one request. Used
 * when adding a book, because asking for the book and its edition record
 * separately took twice as long (HOW_IT_WORKS.md, "Fuller entries when adding").
 * @param {object} answer the whole answer
 * @param {string} isbn 13 digits
 * @param {string} coverUrl where Open Library keeps this ISBN's cover (given by the edge)
 * @returns {import('./lookup.js').Found|null} null when Open Library does not know the book
 */
export function fromOpenLibraryDetails(answer, isbn, coverUrl) {
  const edition = answer && answer[`ISBN:${isbn}`] && answer[`ISBN:${isbn}`].details;
  const found = fromOpenLibraryEdition(edition, isbn);
  if (!found) return null;
  found.authors = (edition.authors || []).map(author => tidy(author.name)).filter(Boolean);
  found.cover = coverUrl ? { url: coverUrl, source: 'openlibrary', waiting: false } : null;
  return found;
}

/**
 * Read a Google Books volume record (/books/v1/volumes/<id>): height and
 * thickness, the page count, publisher, and the largest cover. Its covers
 * cannot be read by a web page, so the cover waits for the laptop
 * (HOW_IT_WORKS.md, "4.2").
 * @param {object} volume the parsed record
 * @param {string} isbn 13 digits
 * @returns {import('./lookup.js').Found|null} null when the record does not list the ISBN
 */
export function fromGoogleBooksVolume(volume, isbn) {
  const info = volume && volume.volumeInfo;
  if (!info || !info.title || !listsIsbn(info, isbn)) return null;
  const found = emptyFound('googlebooks');
  found.title = titleCase(tidy(info.title));
  found.subtitle = titleCase(tidy(info.subtitle));
  found.authors = (info.authors || []).map(tidy);
  found.publisher = tidy(info.publisher);
  found.year = yearOf(info.publishedDate);
  found.pages = info.pageCount ? String(info.pageCount) : '';
  found.isbn = isbn;
  const size = info.dimensions || {};
  const number = text => String(text || '').replace(/\s*cm$/, '');
  Object.assign(found, sizesFromDimensions(number(size.height), number(size.width), number(size.thickness), 'cm'));
  const links = info.imageLinks || {};
  const picture = links.extraLarge || links.large || links.medium || links.small || links.thumbnail;
  if (picture) found.cover = { url: picture.replace(/^http:/, 'https:').replace('&edge=curl', ''), source: 'googlebooks', waiting: true };
  return found;
}

// A page count alone ("311"), as opposed to pages as printed ("xxviii, 311").
const isBareCount = pages => /^\d+$/.test(pages);

/**
 * One book's fields from every source that answered, best first: the
 * Library of Congress, then HathiTrust, then Open Library, then Google Books. Each field
 * comes from the first source that has it, which gives the order of
 * PLAN.md for bibliographic facts, and for height, thickness and covers
 * "whichever has them". Pages as printed beat a bare page count from any
 * source. Original dates are never produced.
 * @param {(import('./lookup.js').Found|null)[]} answers in order of preference
 * @returns {import('./lookup.js').Found|null}
 */
export function mergeFound(answers) {
  const present = answers.filter(Boolean);
  if (!present.length) return null;
  const merged = present.reduce(combineFound);
  const printed = present.map(found => found.pages).find(pages => pages && !isBareCount(pages));
  const result = printed ? { ...merged, pages: printed } : { ...merged }; // a copy: answers are never changed
  // Only a set's record knew the book: it is called by the set and its volume.
  if (!result.title && result.set) result.title = `${result.set}, vol. ${result.volume}`;
  return result;
}

/**
 * The merged answer, with the works inside taken from a library record
 * (the Library of Congress or HathiTrust) when one lists several: their
 * contents notes name works, where Open Library's table of contents often
 * names chapters. Used on the phone, where Open Library comes first because
 * a library record found by ISBN may describe an older printing.
 * @param {import('./lookup.js').Found|null} merged
 * @param {(import('./lookup.js').Found|null)[]} answers every source's own answer
 * @returns {import('./lookup.js').Found|null} a new object; nothing given is changed
 */
export function withLibraryContents(merged, answers) {
  const library = answers.find(found => found && ['libraryofcongress', 'hathitrust'].includes(found.source) && found.contents.length > 1);
  return merged && library ? { ...merged, contents: library.contents } : merged;
}

// Google's reasons for refusing a key (the "reason" in its error answer), in plain words.
const KEY_PROBLEMS = {
  API_KEY_INVALID: 'Google does not know this key. Check that it was copied whole: it starts with "AIza".',
  SERVICE_DISABLED: 'The Books API is not switched on for this key\'s project. Do step 1 again and click "Enable".',
  API_KEY_SERVICE_BLOCKED: 'The key is limited to other services. In step 3, tick "Books API" under the key\'s API restrictions.',
  API_KEY_HTTP_REFERRER_BLOCKED: 'The key only works on certain websites. In step 3, set "Application restrictions" to "None".',
  API_KEY_ANDROID_APP_BLOCKED: 'The key only works in certain Android apps. In step 3, set "Application restrictions" to "None".',
  API_KEY_IOS_APP_BLOCKED: 'The key only works in certain iPhone apps. In step 3, set "Application restrictions" to "None".',
  RATE_LIMIT_EXCEEDED: 'The key works, but has reached today\'s limit of lookups. It will work again tomorrow.',
};

/**
 * Whether a Google Books key works, from the answer to one lookup made with
 * it (Settings › Advanced, "Test the key"), and why not in plain words.
 * @param {number} status the answer's HTTP status
 * @param {object|null} answer the answer, parsed
 * @returns {{ works: boolean, message: string }}
 */
export function googleKeyVerdict(status, answer) {
  if (status === 200) return { works: true, message: 'The key works: Google Books answered a test lookup.' };
  const error = (answer && answer.error) || {};
  const reasons = [...(error.details || []), ...(error.errors || [])].map(item => item.reason);
  const known = reasons.find(reason => KEY_PROBLEMS[reason]);
  if (known) return { works: false, message: KEY_PROBLEMS[known] };
  if (status === 429) return { works: false, message: KEY_PROBLEMS.RATE_LIMIT_EXCEEDED };
  return { works: false, message: `Google Books refused the key (${status}${error.message ? `: ${error.message}` : ''}).` };
}
