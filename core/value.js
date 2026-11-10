// The value view (PLAN.md, "Value view"): what the owned books are worth,
// in total and by room, how many have no value yet, and the Logos total kept
// apart, since digital licenses are not usually insured. The app never
// guesses a price; books with no value are counted, not estimated.

/**
 * @param {object[]} entries the library's entries (core/library.js)
 * @returns {{ total: number, count: number, missing: number, byPlace: { place: string, total: number, count: number, missing: number }[], logosTotal: number, logosCount: number }}
 *   byPlace: by the first two parts of the location (a house and a room), "No place yet" for none
 */
export function valueSummary(entries) {
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
      const place = copy.location.filter(Boolean).slice(0, 2).join(' › ') || 'No place yet';
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
