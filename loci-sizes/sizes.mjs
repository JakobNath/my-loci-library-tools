// Catalog heights (PLAN.md, "Book sizes"): for each physical edition with an
// ISBN and no height, ask the Library of Congress catalog for its record and
// read the height from the physical description (MARC field 300, "23 cm").
// A height a person typed is never touched. The catalog service has no
// encrypted connection and does not allow calls from web pages, which is why
// this runs on the laptop (HOW_IT_WORKS.md, "4.4b Catalog heights").

import { withField } from '../core/records.js';
import { isbn13 } from '../core/entry.js';

const SERVICE = 'http://lx2.loc.gov:210/lcdb';
const RECHECK_DAYS = 90; // a book the catalog did not know is asked about again after this long

/** The address of the catalog's answer for one ISBN (MARC XML). */
export const catalogUrl = isbn => `${SERVICE}?version=1.1&operation=searchRetrieve&query=bath.isbn=${isbn}&maximumRecords=3&recordSchema=marcxml`;

// The text of every subfield `code` of every datafield `tag` in one MARC XML record.
function subfields(record, tag, code) {
  const values = [];
  for (const [, body] of record.matchAll(new RegExp(`<datafield tag="${tag}"[^>]*>([\\s\\S]*?)</datafield>`, 'g'))) {
    for (const [, text] of body.matchAll(new RegExp(`<subfield code="${code}">([^<]*)</subfield>`, 'g'))) values.push(text);
  }
  return values;
}

/**
 * The height in millimeters from a catalog answer, from the record that
 * lists this ISBN (the catalog sometimes answers with other books too).
 * Heights are given in whole centimeters, rounded up; "24 x 30 cm" is height first.
 * @returns {number|null}
 */
export function heightFromAnswer(xml, isbn) {
  for (const [record] of xml.matchAll(/<record[\s>][\s\S]*?<\/record>/g)) {
    const isbns = subfields(record, '020', 'a').map(text => isbn13(text.split(' ')[0]));
    if (!isbns.includes(isbn)) continue;
    for (const text of subfields(record, '300', 'c')) {
      const match = text.match(/(\d+(?:\.\d+)?)\s*(?:x\s*\d+(?:\.\d+)?\s*)?cm/);
      if (match) return Math.round(Number(match[1]) * 10);
    }
  }
  return null;
}

/**
 * Fill catalog heights.
 * @param {object[]} editions every edition record
 * @param {{ fetchFn: typeof fetch, now: string, checked: Record<string, string>, limit?: number, pauseMs?: number }} options
 *   checked: ISBN → day last asked, for books the catalog did not know (kept between runs)
 * @returns {Promise<{ changed: object[], filled: { title: string, mm: number }[], unknown: number, failed: string[] }>}
 */
export async function fillHeights(editions, { fetchFn, now, checked, limit = Infinity, pauseMs = 0 }) {
  const today = now.slice(0, 10);
  const recent = day => day && (Date.parse(today) - Date.parse(day)) / 86400000 < RECHECK_DAYS;
  const report = { changed: [], filled: [], unknown: 0, failed: [] };
  const waiting = editions.filter(edition => edition.medium === 'physical' && !edition.trashed && edition.isbn
    && edition.height === null && edition.heightSource !== 'measured' && !recent(checked[edition.isbn]));
  for (const edition of waiting.slice(0, limit)) {
    let xml;
    try {
      const response = await fetchFn(catalogUrl(edition.isbn), { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`answered ${response.status}`);
      xml = await response.text();
    } catch (error) {
      report.failed.push(`${edition.title}: ${error.message}`);
      continue;
    }
    const mm = heightFromAnswer(xml, edition.isbn);
    if (mm) {
      report.changed.push(withField(withField(edition, 'height', mm, now), 'heightSource', 'catalog', now));
      report.filled.push({ title: edition.title, mm });
      delete checked[edition.isbn];
    } else {
      report.unknown++;
      checked[edition.isbn] = today;
    }
    if (pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs)); // gentle on a free public service
  }
  return report;
}
