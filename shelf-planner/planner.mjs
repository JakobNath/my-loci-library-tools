// The shelf planner's three actions on a data repository, as the admin page
// asks for them: list a place's shelves, suggest an arrangement, and record
// one once the books are moved. Only "record" writes, and only copy records
// and integrations/shelves.txt (the shelf widths, kept for next time).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords, writeRecord, isGitRepo, git, commitAndPush, FOLDERS } from '../shared/data-repo.mjs';
import { isInside } from '../core/library.js';
import { readShelves, shelvesText, planShelves, recordsForPlan, planText } from './plan.mjs';

export const SHELVES_FILE = join('integrations', 'shelves.txt');
const placeOf = text => String(text || '').split(/\s*›\s*/).map(part => part.trim()).filter(Boolean);

/**
 * The shelves under a place: those already written down with their widths,
 * then any other shelf a book stands on there, with its width still to fill in.
 */
export function shelvesFor(dataRepo, placeText) {
  const place = placeOf(placeText);
  if (!place.length) throw new Error('Name the place first, such as "Home › Office" or "Home › Office › Case 1".');
  const saved = existsSync(join(dataRepo, SHELVES_FILE)) ? readShelves(readFileSync(join(dataRepo, SHELVES_FILE), 'utf8')).shelves : [];
  const known = saved.filter(shelf => isInside(shelf.location, place));
  const seen = new Set(known.map(shelf => shelf.location.join(' › ')));
  const found = new Set();
  for (const record of readRecords(dataRepo)) {
    // A shelf is the fourth part of a location; a book placed only as far as a room or bookcase stands on none.
    if (record.type !== 'copy' || record.trashed || record.status !== 'owned') continue;
    const location = record.location.filter(Boolean);
    if (location.length < 4 || !isInside(location, place)) continue;
    const key = location.join(' › ');
    if (!seen.has(key)) found.add(key);
  }
  const unknown = [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(key => `${key} = `);
  return [shelvesText(known), ...unknown].filter(Boolean).join('\n');
}

/** Suggest an arrangement; writes nothing. */
export function suggest(dataRepo, { place, shelves, order }) {
  const read = readShelves(shelves);
  if (read.problems.length) return { ok: false, output: read.problems.join('\n') };
  if (!read.shelves.length) return { ok: false, output: 'List the shelves first, each with its width in cm.' };
  const plan = planShelves(readRecords(dataRepo), { place: placeOf(place), shelves: read.shelves, order });
  return { ok: true, output: planText(plan), plan };
}

/**
 * Record the arrangement as it now stands on the shelves: each copy's shelf
 * and its place along it, and the shelves' widths. Committed as one change.
 */
export function record(dataRepo, { place, shelves, order }, { now, useGit = isGitRepo(dataRepo) } = {}) {
  const suggestion = suggest(dataRepo, { place, shelves, order });
  if (!suggestion.ok) return suggestion;
  if (suggestion.plan.left.length) return { ok: false, output: `${suggestion.plan.left.length} books do not fit on these shelves, so nothing was recorded. Add a shelf or choose a smaller place.` };
  if (useGit) git(dataRepo, 'pull', '--ff-only');
  const records = readRecords(dataRepo);
  const changed = recordsForPlan(records, suggestion.plan, now);
  for (const copy of changed) writeRecord(dataRepo, copy);
  // The widths are kept for next time, merged with the shelves of other places.
  const path = join(dataRepo, SHELVES_FILE);
  const others = existsSync(path) ? readShelves(readFileSync(path, 'utf8')).shelves : [];
  const given = readShelves(shelves).shelves;
  const keys = new Set(given.map(shelf => shelf.location.join(' › ')));
  mkdirSync(join(dataRepo, 'integrations'), { recursive: true });
  writeFileSync(path, `${shelvesText([...others.filter(shelf => !keys.has(shelf.location.join(' › '))), ...given])}\n`);
  const committed = useGit && commitAndPush(dataRepo, [FOLDERS.copy, SHELVES_FILE], `Record the shelf arrangement of ${placeOf(place).join(' › ')}`);
  return { ok: true, output: `Recorded: ${changed.length} copies have their new shelf and order.${committed ? ' Committed and pushed; the phones see it at their next sync.' : ''}` };
}
