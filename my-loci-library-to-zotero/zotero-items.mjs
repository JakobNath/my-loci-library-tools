// What Loci sends to Zotero (PLAN.md, "my-loci-library-to-zotero"): one book
// item per edition, and one book section per work inside an anthology that is
// sent. The original date and the pinned citation key go in Zotero's own
// Original Date and Citation Key fields. Nothing goes in URL, Loc. in Archive
// or Extra, because Chicago prints URL and Loc. in Archive in citations, and
// Better BibTeX may export stray Extra lines as a note: citations must hold
// only bibliographic data. The book's permanent Loci link, with its shelf in
// the title, is a link attached under the book (HOW_IT_WORKS.md, "Zotero fields").

import { editionToCsl, cslName, volumeOfSet, editionForCitation } from '../core/zotero.js';
import { sortYearOf } from '../core/dating.js';
import { isBible } from '../core/bible.js';

export const APP_URL = 'https://jakobnath.github.io/my-loci-library/';
export const TAG_GONE = 'Loci: no longer owned';
export const TAG_REMOVED = 'Loci: removed';
// Lines the companion writes or once wrote in Extra; they are replaced when found.
// Only "volume-title" is written now: Zotero has no field for a volume's own
// title, and Zotero's Chicago style reads this line from Extra.
const OUR_EXTRA = /^(Original Date|Citation Key|volume-title):/i;

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
  const set = volumeOfSet(edition);
  const shared = {
    extra: set && set.volumeTitle ? `volume-title: ${set.volumeTitle}` : '',
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
      edition: editionForCitation(edition.editionStatement),
      series: set ? edition.series || '' : edition.series || edition.set || '',
      seriesNumber: edition.seriesNumber || '',
      volume: edition.volume || '',
      numPages: '',
      // The Library of Congress call number, which Chicago does not print. Sent only when
      // Loci has one, so call numbers already in Zotero are never emptied.
      ...(edition.identifiers.lcc ? { callNumber: edition.identifiers.lcc } : {}),
      ...shared,
    },
  };
  const items = [book];
  if (entry.works.length > 1 && !isBible(entry)) {
    // A section is cited with the volume's editors and, unless the work has its own
    // translator, the volume's translators ("ed. and trans. Michael W. Holmes").
    const editors = edition.contributors.filter(person => person.role === 'editor').map(person => creator(cslName(person.name), 'editor'));
    const translators = edition.contributors.filter(person => person.role === 'translator').map(person => creator(cslName(person.name), 'translator'));
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
          volume: edition.volume || '',
          creators: [...authors.map(name => creator(name, 'author')), ...editors, ...(piece.translator ? [creator(cslName(piece.translator), 'translator')] : translators)],
          edition: editionForCitation(edition.editionStatement),
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
