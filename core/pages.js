// Counting pages from the pages field as printed: "xxviii, 311" is 339 pages,
// and a journal issue printed as "89–132" is 44 pages, not 132.

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

function romanValue(text) {
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN[text[i]];
    const next = ROMAN[text[i + 1]] || 0;
    total += value < next ? -value : value;
  }
  return total;
}

/**
 * Count the pages in a pages field.
 * @param {string|null} printed e.g. "311", "xxviii, 311", "89–132", "4 v."
 * @returns {number|null} null when there is no count to be had (empty, or a set of volumes)
 */
export function countPages(printed) {
  if (!printed) return null;
  const text = String(printed).toLowerCase().replace(/[‒–—]/g, '-').trim();
  if (/\bv(?:ol)?s?\.|\bvolumes?\b/.test(text)) return null;

  const range = text.match(/^p*\.?\s*(\d+)\s*-\s*(\d+)\s*(?:p\.?)?$/);
  if (range) {
    const first = Number(range[1]);
    const last = Number(range[2]);
    return last >= first ? last - first + 1 : null;
  }

  let total = 0;
  for (const part of text.split(/[,;+]/)) {
    const piece = part.replace(/\bp(?:p|ages)?\.?/g, '').replace(/[[\]*]/g, '').trim();
    if (/^\d+$/.test(piece)) total += Number(piece);
    else if (/^[ivxlcdm]+$/.test(piece)) total += romanValue(piece);
  }
  return total > 0 ? total : null;
}
