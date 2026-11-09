// An anthology's date range, worked out from the works it contains. It is
// never stored (DATA_FORMAT.md, "Contents"), so it follows any change to the
// contents or their datings by itself.

import { sortYearOf, workingDating } from './dating.js';

/**
 * The span of an edition's contents.
 * @param {object} edition an edition record
 * @param {Map<string, object>} worksById every work, by ID
 * @returns {{ earliest: number|null, latest: number|null, count: number, missing: string[] }}
 *   earliest: the earliest sort year; latest: the latest year among the working
 *   datings; count: the number of works; missing: IDs of works with no dating yet.
 */
export function anthologyRange(edition, worksById) {
  let earliest = null;
  let latest = null;
  const missing = [];
  for (const entry of edition.contents) {
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
