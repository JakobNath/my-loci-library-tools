// What Loci sends to Zotero (PLAN.md, "my-loci-library-to-zotero"): one book
// item per edition, and one book section per work inside an anthology that is
// sent. The original date and the pinned citation key go in Zotero's own
// Original Date and Citation Key fields. Nothing goes in URL, Loc. in Archive
// or Extra, because Chicago prints URL and Loc. in Archive in citations, and
// Better BibTeX may export stray Extra lines as a note: citations must hold
// only bibliographic data. The book's permanent Loci link, with its shelf in
// the title, is a link attached under the book (HOW_IT_WORKS.md, "Zotero fields").

import { editionToCsl, cslName } from '../core/zotero.js';
import { sortYearOf } from '../core/dating.js';
import { normalizeForSearch } from '../core/search.js';

export const APP_URL = 'https://jakobnath.github.io/my-loci-library/';
export const TAG_GONE = 'Loci: no longer owned';
export const TAG_REMOVED = 'Loci: removed';
// Lines the first version of the companion wrote in Extra; they are removed when found.
const OUR_EXTRA = /^(Original Date|Citation Key):/i;

const CREATOR_TYPES = { translator: 'translator', editor: 'editor', illustrator: 'contributor', introduction: 'contributor', other: 'contributor' };

// A CSL name as a Zotero creator.
const creator = (name, creatorType) => (name.literal ? { creatorType, name: name.literal } : { creatorType, firstName: name.given, lastName: name.family });

/** The permanent link to a book in the app: a fixed pattern holding only the record ID. */
export const lociLink = (editionId, appUrl = APP_URL) => `${appUrl}#/book/${editionId}`;

// The books of the Bible, with the deuterocanonical books and other common
// names, as plain lowercase words ("1 corinthians", "song of songs").
const BIBLE_BOOKS = new Set([
  'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges', 'ruth', '1 samuel', '2 samuel', '1 kings', '2 kings',
  '1 chronicles', '2 chronicles', 'ezra', 'nehemiah', 'esther', 'job', 'psalms', 'psalm', 'proverbs', 'ecclesiastes', 'qoheleth',
  'song of songs', 'song of solomon', 'canticles', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel', 'daniel', 'hosea', 'joel', 'amos',
  'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk', 'zephaniah', 'haggai', 'zechariah', 'malachi',
  'tobit', 'judith', 'wisdom of solomon', 'wisdom', 'sirach', 'ecclesiasticus', 'baruch', '1 maccabees', '2 maccabees', '3 maccabees', '4 maccabees',
  '1 esdras', '2 esdras', 'prayer of manasseh', 'additions to esther', 'letter of jeremiah',
  'matthew', 'mark', 'luke', 'john', 'acts', 'acts of the apostles', 'romans', '1 corinthians', '2 corinthians', 'galatians', 'ephesians',
  'philippians', 'colossians', '1 thessalonians', '2 thessalonians', '1 timothy', '2 timothy', 'titus', 'philemon', 'hebrews', 'james',
  '1 peter', '2 peter', '1 john', '2 john', '3 john', 'jude', 'revelation', 'apocalypse',
]);

/**
 * Whether a book is a Bible (or a Testament), whose parts are cited by book,
 * chapter and verse, never as sections of a book (Chicago Manual of Style;
 * SBL Handbook): marked as one by its category or by Logos, or an anthology
 * at least half of whose works are books of the Bible (NA28, BHS, a study Bible).
 */
export function isBible(entry) {
  if (entry.edition.logosExtra && entry.edition.logosExtra['Resource Type'] === 'Bible') return true;
  if (entry.works.some(work => /^bibles?$/i.test(work.category || ''))) return true;
  const biblical = entry.works.filter(work => BIBLE_BOOKS.has(normalizeForSearch(work.title).replace(/^the /, '').replace(/^(first|second|third) /, word => ({ 'first ': '1 ', 'second ': '2 ', 'third ': '3 ' })[word]))).length;
  return entry.works.length > 1 && biblical * 2 >= entry.works.length;
}

/**
 * Which editions go to Zotero: every physical edition, and Logos editions marked "cite".
 * Wishlist items are not editions and never go.
 */
export const isSent = edition => !edition.trashed && (edition.medium === 'physical' || edition.cite === true);

/**
 * The Zotero items for one library entry: the book, and a section for each
 * work when it is an anthology, except a Bible (decided with Jakob, 2026-11-10).
 * Keys: the edition ID, and "<edition id>/<work id>".
 * Citation keys are filled in by the caller (they must stay pinned).
 * @returns {{ linkId: string, base: string, data: object }[]} base: the key's author-and-year part
 */
export function itemsFor(entry, library, { appUrl = APP_URL } = {}) {
  const { edition } = entry;
  const csl = editionToCsl(edition, library.worksById, library.authorsById);
  const location = (entry.copies.find(copy => copy.status === 'owned' && copy.location.length) || { location: [] }).location.filter(Boolean).join(' › ');
  const people = [
    ...csl.author.map(name => creator(name, 'author')),
    ...edition.contributors.map(person => creator(cslName(person.name), CREATOR_TYPES[person.role] || 'contributor')),
  ];
  const shared = {
    publisher: edition.publisher || '',
    place: edition.place || '',
    date: edition.year ? String(edition.year) : '',
    ISBN: edition.isbn || '',
    language: edition.languages.join(', '),
  };
  const originalDate = csl['original-date'] ? csl['original-date']['date-parts'][0][0] : null;
  const book = {
    linkId: edition.id,
    csl,
    year: edition.year,
    // The link attached under the book: to it in Loci, titled with its shelf.
    attachment: { title: location ? `My Loci Library · ${location}` : 'My Loci Library', url: lociLink(edition.id, appUrl) },
    data: {
      originalDate: originalDateText(originalDate),
      itemType: 'book',
      title: csl.title,
      creators: people,
      edition: edition.editionStatement || '',
      series: edition.series || edition.set || '',
      seriesNumber: edition.seriesNumber || '',
      volume: edition.volume || '',
      numPages: '',
      ...shared,
    },
  };
  const items = [book];
  if (entry.works.length > 1 && !isBible(entry)) {
    const editors = edition.contributors.filter(person => person.role === 'editor').map(person => creator(cslName(person.name), 'editor'));
    for (const piece of edition.contents) {
      const work = library.worksById.get(piece.work);
      if (!work) continue;
      const authors = work.authors.map(id => library.authorsById.get(id)).filter(Boolean).map(author => cslName(author.name, author.sortName));
      const year = sortYearOf(work);
      items.push({
        linkId: `${edition.id}/${work.id}`,
        csl: { author: authors, editor: [], title: work.title },
        year: edition.year,
        data: {
          originalDate: originalDateText(year),
          itemType: 'bookSection',
          title: work.subtitle ? `${work.title}: ${work.subtitle}` : work.title,
          bookTitle: csl.title,
          creators: [...authors.map(name => creator(name, 'author')), ...editors, ...(piece.translator ? [creator(cslName(piece.translator), 'translator')] : [])],
          pages: piece.pages || '',
          series: edition.series || '',
          seriesNumber: edition.seriesNumber || '',
          ...shared,
        },
      });
    }
  }
  return items;
}

/**
 * An original date as Zotero's Original Date field takes it: a year ("397"),
 * or a year before Christ written out ("385 BC"), which Zotero keeps and
 * Chicago prints as it is written.
 */
export function originalDateText(year) {
  if (year === null || year === undefined) return '';
  return year < 0 ? `${-year} BC` : String(year);
}

/** Extra without the lines the first version of the companion wrote there; every line a person wrote is kept. */
export function extraWithout(existing) {
  return String(existing || '').split('\n').filter(line => !OUR_EXTRA.test(line)).join('\n').trim();
}

/**
 * A citation key already pinned on an item, if any: Zotero 7's own Citation
 * Key field, or else a "Citation Key:" line in Extra (where Better BibTeX kept
 * pinned keys before Zotero had the field).
 */
export function pinnedKey(data) {
  if (data.citationKey) return data.citationKey;
  const match = String(data.extra || '').match(/^Citation Key:\s*(\S+)/im);
  return match ? match[1] : null;
}

/** The Loci tags an item should carry: none while owned, else why it left. */
export function lociTags(entry, removed) {
  if (removed) return [TAG_REMOVED];
  return entry.owned ? [] : [TAG_GONE];
}
