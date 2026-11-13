// The value view (PLAN.md, "Value view"): what the owned books are worth,
// in total and by place, room, bookcase or shelf, how many have no value yet, and the Logos total kept
// apart, since digital licenses are not usually insured. The app never
// guesses a price; books with no value are counted, not estimated.
//
// A set with its own record (DATA_FORMAT.md, "Set") is counted once. While
// its switch `valueAsSet` is off, each volume counts its own value, and the
// set's value, when given, counts once for the volumes bought with it, which
// leave their own value empty. With the switch on, only the set's value
// counts; the volumes' own values are kept but not counted.

/**
 * How one copy's value is counted.
 * @param {object} copy
 * @param {object|null} set the set record of the copy's edition, if it has one
 * @returns {{ value: number|null, withSet: boolean }} withSet: the set's value covers it
 *   (so it is not missing); value null and withSet false: no value yet
 */
export function copyValueOf(copy, set) {
  const setValued = Boolean(set && set.value !== null && set.value !== undefined);
  if (setValued && set.valueAsSet) return { value: null, withSet: true };
  if (copy.value !== null && copy.value !== undefined) return { value: copy.value, withSet: false };
  return { value: null, withSet: setValued };
}

/**
 * @param {object[]} entries the library's entries (core/library.js), each with its `set` record or null
 * @param {number} depth how many parts of a location to total by: 1 a place, 2 a room (the default), 3 a bookcase, 4 a shelf
 * @returns {{ total: number, count: number, missing: number, byPlace: { place: string, total: number, count: number, missing: number }[], logosTotal: number, logosCount: number, sets: { set: object, place: string, volumes: number, isDigital: boolean }[] }}
 *   byPlace: by the first `depth` parts of the location, "No place yet" for none;
 *   sets: each set whose own value is counted, with where it is counted (the
 *   place holding most of its owned volumes) and how many volumes are owned
 */
export function valueSummary(entries, depth = 2) {
  const summary = { total: 0, count: 0, missing: 0, byPlace: [], logosTotal: 0, logosCount: 0, sets: [] };
  const places = new Map();
  const rowOf = place => {
    if (!places.has(place)) places.set(place, { place, total: 0, count: 0, missing: 0 });
    return places.get(place);
  };
  const setsSeen = new Map(); // set ID → { set, placeCounts: Map, volumes, physical }
  for (const entry of entries) {
    const set = entry.set || null;
    for (const copy of entry.copies) {
      if (copy.status !== 'owned') continue;
      const counted = copyValueOf(copy, set);
      const place = copy.location.filter(Boolean).slice(0, depth).join(' › ') || 'No place yet';
      if (set && set.value !== null && set.value !== undefined) {
        if (!setsSeen.has(set.id)) setsSeen.set(set.id, { set, placeCounts: new Map(), volumes: 0, physical: 0 });
        const seen = setsSeen.get(set.id);
        seen.volumes++;
        if (!entry.isDigital) {
          seen.physical++;
          seen.placeCounts.set(place, (seen.placeCounts.get(place) || 0) + 1);
        }
      }
      if (entry.isDigital) {
        summary.logosCount++;
        summary.logosTotal += counted.value || 0;
        continue;
      }
      const row = rowOf(place);
      row.count++;
      summary.count++;
      if (counted.value === null && !counted.withSet) { row.missing++; summary.missing++; continue; }
      row.total += counted.value || 0;
      summary.total += counted.value || 0;
    }
  }
  // Each valued set once: where most of its owned volumes stand (ties go to
  // the place first in alphabetical order), or with Logos when all are digital.
  for (const { set, placeCounts, volumes, physical } of setsSeen.values()) {
    if (!physical) {
      summary.logosTotal += set.value;
      summary.sets.push({ set, place: 'Logos', volumes, isDigital: true });
      continue;
    }
    const [place] = [...placeCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    rowOf(place).total += set.value;
    summary.total += set.value;
    summary.sets.push({ set, place, volumes, isDigital: false });
  }
  summary.byPlace = [...places.values()].sort((a, b) => b.total - a.total || a.place.localeCompare(b.place));
  summary.sets.sort((a, b) => a.set.title.localeCompare(b.set.title));
  return summary;
}

// The levels of a location the totals can be grouped by, as the Value page names them.
export const VALUE_LEVELS = [{ depth: 1, label: 'Place' }, { depth: 2, label: 'Room' }, { depth: 3, label: 'Bookcase' }, { depth: 4, label: 'Shelf' }];
