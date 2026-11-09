// Turning an edition into a CSL-JSON item, the citation format Zotero and
// the CSL-JSON export both read. The Zotero tool (phase 12) sends these.

import { sortYearOf } from './dating.js';

const ROLE_TO_CSL = { translator: 'translator', editor: 'editor', illustrator: 'illustrator' };

/**
 * A person's name in CSL form: family and given names when the name has a
 * sort form ("Chemnitz, Martin"), otherwise the name as one piece.
 */
export function cslName(name, sortName = null) {
  if (sortName && sortName.includes(',')) {
    const [family, given] = sortName.split(',').map(part => part.trim());
    return { family, given };
  }
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return { literal: name.trim() };
  return { family: words[words.length - 1], given: words.slice(0, -1).join(' ') };
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
  const authorIds = [...new Set(works.flatMap(work => work.authors))];
  const item = {
    id: edition.id,
    type: 'book',
    title: edition.subtitle ? `${edition.title}: ${edition.subtitle}` : edition.title,
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
  if (edition.isbn) item.ISBN = edition.isbn;
  if (edition.languages.length) item.language = edition.languages.join(', ');

  // The original date shows in Chicago citations: "(1991; orig. 397)".
  // For one work it is that work's sort year; for an anthology, its earliest.
  const years = works.map(sortYearOf).filter(year => year !== null);
  if (years.length) item['original-date'] = { 'date-parts': [[Math.min(...years)]] };
  return item;
}
