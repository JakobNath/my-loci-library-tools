// An anthology's date range, worked out from the works it contains. It is
// never stored (DATA_FORMAT.md, "Contents"), so it follows any change to the
// contents or their datings by itself.

import { sortYearOf, workingDating, parseDating } from './dating.js';

/**
 * The span of an edition's contents.
 * @param {object} edition an edition record
 * @param {Map<string, object>} worksById every work, by ID
 * @returns {{ earliest: number|null, latest: number|null, count: number, missing: string[] }}
 *   earliest: the earliest sort year; latest: the latest year among the working
 *   datings; count: the number of works and pieces; missing: IDs of works with no dating
 *   yet, and titles of pieces without a readable date.
 */
export function anthologyRange(edition, worksById) {
  let earliest = null;
  let latest = null;
  const missing = [];
  for (const entry of edition.contents) {
    // A piece's date is the text typed or listed with it; one that cannot be read is counted as missing.
    if (entry.piece) {
      const read = parseDating(entry.piece.date || '');
      if (!read.ok) { missing.push(entry.piece.title); continue; }
      const start = read.dating.earliest ?? read.dating.latest;
      const end = read.dating.latest ?? read.dating.earliest;
      if (start !== null && (earliest === null || start < earliest)) earliest = start;
      if (end !== null && (latest === null || end > latest)) latest = end;
      continue;
    }
    const work = worksById.get(entry.work);
    const dating = work && workingDating(work);
    if (!dating) {
      missing.push(entry.work);
      continue;
    }
    const start = sortYearOf(work);
    const end = dating.latest ?? dating.earliest;
    if (start !== null && (earliest === null || start < earliest)) earliest = start;
    if (end !== null && (latest === null || end > latest)) latest = end;
  }
  return { earliest, latest, count: edition.contents.length, missing };
}
