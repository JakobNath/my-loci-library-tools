// Turning an edition into a CSL-JSON item, the citation format Zotero and
// the CSL-JSON export both read. The Zotero tool (phase 12) sends these.

import { sortYearOf } from './dating.js';

const ROLE_TO_CSL = { translator: 'translator', editor: 'editor', illustrator: 'illustrator' };

// Ancient and medieval writers are known by a whole name, not a surname, and
// Chicago lists them that way ("Ignatius of Antioch", "Thomas à Kempis",
// "Justin Martyr", "John Chrysostom"; Chicago Manual of Style, names of persons
// in antiquity and the Middle Ages). Such names are kept whole: a name with a
// joining word (of, à, the), or ending in one of these customary epithets.
const WHOLE_NAME = /\s(of|à|a|the)\s|\s(Martyr|Chrysostom|Nazianzen|Damascene|Aquinas|Confessor|Venerable|Great)$/;

/**
 * A person's name in CSL form. A sort form with a comma ("Chemnitz, Martin")
 * gives family and given names; a sort form without one keeps the name whole,
 * as does a single word ("Augustine") or a premodern name ("Ignatius of
 * Antioch"); otherwise the last word is the family name.
 */
export function cslName(name, sortName = null) {
  if (sortName && sortName.includes(',')) {
    const [family, given] = sortName.split(',').map(part => part.trim());
    return { family, given };
  }
  if (sortName) return { literal: sortName.trim() };
  const words = name.trim().split(/\s+/);
  if (words.length === 1 || WHOLE_NAME.test(name.trim())) return { literal: name.trim() };
  return { family: words[words.length - 1], given: words.slice(0, -1).join(' ') };
}

/**
 * A citation key in the Better BibTeX pattern we already use in Zotero
 * (PLAN.md, "Citekeys and note names"): the first author's surname, or else
 * the first editor's, folded to plain letters, then the edition's year
 * ("Adler1972"). With no person, the title's first word. Repeats get a, b, c
 * added by whoever hands the keys out (core/exports.js, the Zotero tool).
 * @param {object} item a CSL-JSON item (editionToCsl)
 * @param {number|null} year the edition's year
 */
export function citationKeyBase(item, year) {
  const plain = text => String(text || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '');
  const person = (item.author && item.author[0]) || (item.editor && item.editor[0]);
  const word = plain(person && (person.family || person.literal)) || plain(String(item.title || '').replace(/^(the|a|an) /i, '').split(/\s/)[0]) || 'Book';
  return `${word[0].toUpperCase()}${word.slice(1)}${year || ''}`;
}

/** The next free key for a base: the base itself, then base + a, b, c... */
export function freeCitationKey(base, taken) {
  if (!taken.has(base)) return base;
  for (let i = 0; ; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : `${String.fromCharCode(97 + Math.floor(i / 26) - 1)}${String.fromCharCode(97 + (i % 26))}`;
    if (!taken.has(base + suffix)) return base + suffix;
  }
}

const plain = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * A volume of a multivolume set (The Ante-Nicene Fathers, vol. 1): the set's
 * title, the volume number, and the volume's own title, if it has one. CSL
 * calls these title, volume and volume-title, and Chicago prints them as
 * "The Apostolic Fathers, Justin Martyr, Irenaeus, vol. 1 of The Ante-Nicene
 * Fathers". A volume entered as "The Ante-Nicene Fathers: Volume 1: The
 * Apostolic Fathers…" has its own title after "Volume 1".
 * @returns {{ title: string, volume: string, volumeTitle: string }|null} null when the edition is not a volume of a set
 */
export function volumeOfSet(edition) {
  if (!edition.set || !edition.volume) return null;
  const full = edition.subtitle ? `${edition.title}: ${edition.subtitle}` : edition.title;
  let own = full;
  if (plain(edition.title) === plain(edition.set)) own = String(edition.subtitle || '').replace(/^(vol(ume)?\.?|v\.)\s*[\w.]+\s*[:.,–—-]?\s*/i, '').trim();
  return { title: edition.set, volume: String(edition.volume), volumeTitle: plain(own) === plain(edition.set) ? '' : own };
}

/**
 * A CSL-JSON item for an edition.
 * @param {object} edition
 * @param {Map<string, object>} worksById
 * @param {Map<string, object>} authorsById
 * @returns {object}
 */
export function editionToCsl(edition, worksById, authorsById) {
  const works = edition.contents.map(entry => worksById.get(entry.work)).filter(Boolean);
  // A collection names as its authors only those every work shares: Plato for
  // his dialogues, Luther for Luther's Works. A collection of many authors (the
  // Apostolic Fathers) is cited under its editors (Chicago Manual of Style).
  const authorIds = works.length > 1
    ? works[0].authors.filter(id => works.every(work => work.authors.includes(id)))
    : [...new Set(works.flatMap(work => work.authors))];
  const set = volumeOfSet(edition);
  const item = {
    id: edition.id,
    type: 'book',
    title: set ? set.title : edition.subtitle ? `${edition.title}: ${edition.subtitle}` : edition.title,
    author: authorIds.map(id => authorsById.get(id)).filter(Boolean).map(author => cslName(author.name, author.sortName)),
  };
  for (const contributor of edition.contributors) {
    const key = ROLE_TO_CSL[contributor.role];
    if (key) (item[key] = item[key] || []).push(cslName(contributor.name));
  }
  if (edition.publisher) item.publisher = edition.publisher;
  if (edition.place) item['publisher-place'] = edition.place;
  if (edition.year) item.issued = { 'date-parts': [[edition.year]] };
  if (edition.editionStatement) item.edition = edition.editionStatement;
  if (edition.series) item['collection-title'] = edition.series;
  if (edition.seriesNumber) item['collection-number'] = edition.seriesNumber;
  if (edition.volume) item.volume = edition.volume;
  if (set && set.volumeTitle) item['volume-title'] = set.volumeTitle;
  if (edition.isbn) item.ISBN = edition.isbn;
  if (edition.languages.length) item.language = edition.languages.join(', ');

  // The original date shows in Chicago citations: "(1991; orig. 397)". Only a
  // book holding one work has one: a collection has no single original date
  // (the Concordia Triglotta is not "orig. 301"), so its works carry their own.
  const year = works.length === 1 ? sortYearOf(works[0]) : null;
  if (year !== null) item['original-date'] = { 'date-parts': [[year]] };
  return item;
}
