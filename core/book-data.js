// The fuller book records of Open Library (the edition record) and Google
// Books (the volume record), and how the three sources are merged
// (PLAN.md, "Book data"). The Library of Congress is read in core/marc.js.
// Only answers are read here; the edges and the laptop tool fetch them.

import { isbn13 } from './entry.js';
import { emptyFound, combineFound, contributorsFrom, cleanPages, titleCase, tidy, yearOf, listsIsbn } from './lookup.js';
import { LANGUAGE_NAMES } from './marc.js';

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
 * "8.4 x 5.4 x 1.8 inches", "22 x  x  centimeters". A thickness is kept only
 * when it is less than the width and half the height: records sometimes give
 * the three in another order (Hackett's Plato: 24 × 9.5 × 16.1 cm).
 * @returns {{ height: number|null, thickness: number|null }}
 */
export function sizesFromDimensions(height, width, thickness, unit) {
  const scale = /in/i.test(unit) ? 25.4 : /mm/i.test(unit) ? 1 : 10;
  const mm = text => (Number(text) > 0 ? Math.round(Number(text) * scale) : null);
  const sizes = { height: mm(height), thickness: mm(thickness) };
  const tooThick = sizes.thickness && ((sizes.height && sizes.thickness >= sizes.height / 2) || (mm(width) && sizes.thickness >= mm(width)));
  if (tooThick) sizes.thickness = null;
  return sizes;
}

// Front and back matter in a table of contents are not works.
const NOT_A_WORK = /^(preface|foreword|prologue|introduction|acknowledg|contents|index|bibliograph|notes|abbreviations|appendix|glossary|list of|further reading|chronology)/i;

// The top level of Open Library's table of contents, as works an anthology may hold.
function contentsFromToc(toc) {
  const entries = (toc || []).filter(entry => entry && tidy(entry.title));
  const top = Math.min(...entries.map(entry => entry.level || 0));
  return entries.filter(entry => (entry.level || 0) === top && !NOT_A_WORK.test(tidy(entry.title)))
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
  found.editionStatement = tidy(edition.edition_name).replace(/[[\]]/g, '').replace(/\.\.$/, '.');
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
  };
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
 * Library of Congress, then Open Library, then Google Books. Each field
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
  return printed ? { ...merged, pages: printed } : merged;
}
