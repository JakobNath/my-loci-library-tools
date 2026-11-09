// A book's height and thickness for the shelf view: the stored value when a
// person or a catalog gave one, otherwise an estimate worked out each time.
// The order of sources is in PLAN.md under "Book sizes". Estimates are never stored.

import { countPages } from './pages.js';

// Typical heights in millimeters, chosen from common trade formats.
const TYPICAL_HEIGHT = [
  [/mass-market/i, 178],
  [/paperback|softcover/i, 215],
  [/journal/i, 230],
  [/bonded|imitation|flexible|leather-like/i, 220],
  [/hardcover|cloth|leather|library|case/i, 235],
];
const UNKNOWN_HEIGHT = 225;

// Paper is about 0.06 mm a page; covers add about 0.5 mm (paperback) or 5.5 mm (boards).
const MM_PER_PAGE = 0.06;
const THIN_COVERS = /paperback|softcover|journal|mass-market/i;
const UNKNOWN_PAGES = 380; // a middling guess when the page count is unknown

/**
 * Height and thickness of an edition, each with where it came from.
 * @param {object} edition an edition record
 * @param {object} [options]
 * @param {string|null} [options.binding] the copy's binding, for the typical height and covers
 * @param {object[]} [options.related] other editions in the same series or set
 * @returns {{ height: { mm: number, source: string }, thickness: { mm: number, source: string } }}
 *   sources: measured, catalog, photo, same series, same set, pages, guess
 */
export function estimateSize(edition, { binding = null, related = [] } = {}) {
  return { height: heightOf(edition, binding, related), thickness: thicknessOf(edition, binding) };
}

function heightOf(edition, binding, related) {
  if (edition.height) return { mm: edition.height, source: edition.heightSource || 'measured' };
  const known = related.filter(other => other.id !== edition.id && other.height);
  const sameSeries = edition.series && known.find(other => other.series === edition.series);
  if (sameSeries) return { mm: sameSeries.height, source: 'same series' };
  const sameSet = edition.set && known.find(other => other.set === edition.set);
  if (sameSet) return { mm: sameSet.height, source: 'same set' };
  const typical = TYPICAL_HEIGHT.find(([pattern]) => pattern.test(binding || ''));
  return { mm: typical ? typical[1] : UNKNOWN_HEIGHT, source: 'guess' };
}

function thicknessOf(edition, binding) {
  if (edition.thickness) return { mm: edition.thickness, source: edition.thicknessSource || 'measured' };
  const pages = countPages(edition.pages);
  const covers = THIN_COVERS.test(binding || '') ? 0.5 : 5.5;
  const mm = Math.round(((pages || UNKNOWN_PAGES) * MM_PER_PAGE + covers) * 10) / 10;
  return { mm, source: pages ? 'pages' : 'guess' };
}
