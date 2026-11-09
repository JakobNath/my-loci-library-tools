// Merging two versions of one record edited on different devices: each field
// comes from whichever side changed it last (DATA_FORMAT.md, "Merging").

import { FIELDS } from './records.js';

/**
 * Merge two versions of the same record. Both devices get the same result
 * whichever order they merge in.
 * @param {object} mine
 * @param {object} theirs
 * @returns {object} a new record
 */
export function mergeRecords(mine, theirs) {
  if (mine.id !== theirs.id || mine.type !== theirs.type) {
    throw new Error(`Cannot merge different records: ${mine.type} ${mine.id} and ${theirs.type} ${theirs.id}.`);
  }
  const merged = { ...mine, format: Math.max(mine.format, theirs.format), changed: {} };
  for (const name of [...Object.keys(FIELDS[mine.type]), 'trashed']) {
    const mineAt = mine.changed[name] || '';
    const theirsAt = theirs.changed[name] || '';
    let takeTheirs = theirsAt > mineAt;
    if (theirsAt === mineAt && theirsAt) {
      // Same moment on both sides: settle it the same way on every device.
      takeTheirs = JSON.stringify(theirs[name]) > JSON.stringify(mine[name]);
    }
    merged[name] = takeTheirs ? theirs[name] : mine[name];
    const latest = takeTheirs ? theirsAt : mineAt;
    if (latest) merged.changed[name] = latest;
  }
  return merged;
}
