// The shared settings (DATA_FORMAT.md, "settings.json"): their defaults, and
// the file text, with keys always in the same order.

export const SHARED_DEFAULTS = {
  format: 1,
  dateStyle: 'AD',
  currency: '$',
  anthologiesInShelfLists: 'once',
  batchAddPrompts: ['title', 'subtitle', 'authors', 'datings', 'binding', 'publisher', 'year'],
  defaultSort: { library: 'title', wishlist: 'added' },
  lookups: { openLibrary: true, googleBooks: true },
  bindings: ['Hardcover', 'Hardcover with dust jacket', 'Paperback', 'Mass-market paperback', 'Leather', 'Bonded leather', 'Cloth', 'Library binding', 'Journal issue'],
  views: [],
};

/** Settings read from a file or storage, with a default for anything missing. */
export function withDefaults(settings) {
  return { ...SHARED_DEFAULTS, ...(settings || {}) };
}

/** settings.json as text: keys in the order above, pretty-printed, newline at the end. */
export function settingsToFileText(settings) {
  const full = withDefaults(settings);
  const ordered = Object.fromEntries(Object.keys(SHARED_DEFAULTS).map(key => [key, full[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
