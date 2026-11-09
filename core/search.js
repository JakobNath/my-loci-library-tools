// Search text: accents are ignored and Greek is written in Latin letters, so
// "logos" finds λόγος and "eglise" finds Église. The same normalizing is used
// for the stored search text and for what a person types.

const GREEK = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'e', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'u', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'o',
};
const LIGATURES = { æ: 'ae', œ: 'oe', ß: 'ss', ø: 'o', đ: 'd', ł: 'l', þ: 'th' };

/**
 * Normalize text for searching: lowercase, no accents, Greek in Latin letters,
 * punctuation turned into spaces.
 * @param {string} text
 * @returns {string}
 */
export function normalizeForSearch(text) {
  const plain = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // combining accent marks
  let out = '';
  for (const letter of plain) out += GREEK[letter] ?? LIGATURES[letter] ?? letter;
  return out.replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The search text of an edition: everything a search should find it by.
 * @param {object} edition
 * @param {Map<string, object>} worksById
 * @param {Map<string, object>} authorsById
 * @param {object[]} [copies] the edition's copies, for their notes
 */
export function searchTextOf(edition, worksById, authorsById, copies = []) {
  const parts = [edition.title, edition.subtitle, edition.series, edition.seriesNumber, edition.set, edition.isbn];
  for (const contributor of edition.contributors) parts.push(contributor.name);
  for (const entry of edition.contents) {
    const work = worksById.get(entry.work);
    if (!work) continue;
    parts.push(work.title, work.subtitle, work.originalTitle, ...work.tags, work.category);
    for (const authorId of work.authors) {
      const author = authorsById.get(authorId);
      if (author) parts.push(author.name, ...author.otherNames);
    }
  }
  for (const copy of copies) parts.push(copy.notes);
  return normalizeForSearch(parts.filter(Boolean).join(' '));
}

/**
 * Whether a search text matches what a person typed: every word they typed
 * must appear somewhere (as the start of a word or inside one).
 */
export function matchesSearch(searchText, query) {
  const words = normalizeForSearch(query).split(' ').filter(Boolean);
  return words.every(word => searchText.includes(word));
}
