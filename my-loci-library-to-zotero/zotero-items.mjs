// What Loci sends to Zotero (PLAN.md, "my-loci-library-to-zotero"): one book
// item per edition, and one book section per work inside an anthology that is
// sent. Each carries the original date and the pinned citation key in Extra
// (where Zotero and Better BibTeX read them), the shelf location in "Loc. in
// Archive", and the book's permanent Loci link (record ID only) as its URL.

import { editionToCsl, cslName } from '../core/zotero.js';
import { sortYearOf } from '../core/dating.js';

export const APP_URL = 'https://jakobnath.github.io/my-loci-library/';
export const TAG_GONE = 'Loci: no longer owned';
export const TAG_REMOVED = 'Loci: removed';
const OUR_EXTRA = /^(Original Date|Citation Key):/i;

const CREATOR_TYPES = { translator: 'translator', editor: 'editor', illustrator: 'contributor', introduction: 'contributor', other: 'contributor' };

// A CSL name as a Zotero creator.
const creator = (name, creatorType) => (name.literal ? { creatorType, name: name.literal } : { creatorType, firstName: name.given, lastName: name.family });

/** The permanent link to a book in the app: a fixed pattern holding only the record ID. */
export const lociLink = (editionId, appUrl = APP_URL) => `${appUrl}#/book/${editionId}`;

/**
 * Which editions go to Zotero: every physical edition, and Logos editions marked "cite".
 * Wishlist items are not editions and never go.
 */
export const isSent = edition => !edition.trashed && (edition.medium === 'physical' || edition.cite === true);

/**
 * The Zotero items for one library entry: the book, and a section for each
 * work when it is an anthology. Keys: the edition ID, and "<edition id>/<work id>".
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
    url: lociLink(edition.id, appUrl),
    archiveLocation: location,
  };
  const originalDate = csl['original-date'] ? csl['original-date']['date-parts'][0][0] : null;
  const book = {
    linkId: edition.id,
    csl,
    year: edition.year,
    originalDate,
    data: {
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
  if (entry.works.length > 1) {
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
        originalDate: year,
        data: {
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
 * Extra, with our two lines (original date and pinned key) in place of any
 * earlier ones, and every other line a person wrote kept.
 */
export function extraWith(existing, { originalDate, citationKey }) {
  const kept = String(existing || '').split('\n').filter(line => line.trim() && !OUR_EXTRA.test(line));
  return [...(originalDate !== null && originalDate !== undefined ? [`Original Date: ${originalDate}`] : []), `Citation Key: ${citationKey}`, ...kept].join('\n');
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
