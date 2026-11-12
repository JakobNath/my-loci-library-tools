// The value view (PLAN.md, "Value view"): what the owned books are worth,
// in total and by place, room, bookcase or shelf, how many have no value yet, and the Logos total kept
// apart, since digital licenses are not usually insured. The app never
// guesses a price; books with no value are counted, not estimated.

/**
 * @param {object[]} entries the library's entries (core/library.js)
 * @param {number} depth how many parts of a location to total by: 1 a place, 2 a room (the default), 3 a bookcase, 4 a shelf
 * @returns {{ total: number, count: number, missing: number, byPlace: { place: string, total: number, count: number, missing: number }[], logosTotal: number, logosCount: number }}
 *   byPlace: by the first `depth` parts of the location, "No place yet" for none
 */
export function valueSummary(entries, depth = 2) {
  const summary = { total: 0, count: 0, missing: 0, byPlace: [], logosTotal: 0, logosCount: 0 };
  const places = new Map();
  for (const entry of entries) {
    for (const copy of entry.copies) {
      if (copy.status !== 'owned') continue;
      if (entry.isDigital) {
        summary.logosCount++;
        summary.logosTotal += copy.value || 0;
        continue;
      }
      const place = copy.location.filter(Boolean).slice(0, depth).join(' › ') || 'No place yet';
      if (!places.has(place)) places.set(place, { place, total: 0, count: 0, missing: 0 });
      const row = places.get(place);
      row.count++;
      summary.count++;
      if (copy.value === null || copy.value === undefined) { row.missing++; summary.missing++; continue; }
      row.total += copy.value;
      summary.total += copy.value;
    }
  }
  summary.byPlace = [...places.values()].sort((a, b) => b.total - a.total || a.place.localeCompare(b.place));
  return summary;
}

// The levels of a location the totals can be grouped by, as the Value page names them.
export const VALUE_LEVELS = [{ depth: 1, label: 'Place' }, { depth: 2, label: 'Room' }, { depth: 3, label: 'Bookcase' }, { depth: 4, label: 'Shelf' }];
