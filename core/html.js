// The one helper for putting text from data into HTML. Titles, notes and
// anything from a lookup are data, never markup (CODE_STYLE.md, section 6).

const REPLACEMENTS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escape text so it shows as text inside HTML, including inside attributes.
 * @param {unknown} text null and undefined become an empty string
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, character => REPLACEMENTS[character]);
}
