// The shared settings (DATA_FORMAT.md, "settings.json"): their defaults, and
// the file text, with keys always in the same order. Also the rule for when a
// device moves from one data repository to another.

import { sortBindingList } from './bindings.js';

export const SHARED_DEFAULTS = {
  format: 1,
  dateStyle: 'AD',
  currency: '$',
  anthologiesInShelfLists: 'once',
  batchAddPrompts: ['title', 'subtitle', 'authors', 'datings', 'binding', 'publisher', 'year'],
  defaultSort: { library: 'title', wishlist: 'added' },
  lookups: { openLibrary: true, hathiTrust: true, googleBooks: true, wikidata: true },
  bindings: ['Hardcover', 'Paperback', 'Mass-market paperback', 'Library binding', 'Journal issue'],
  materials: ['Cloth', 'Leather', 'Bonded leather'],
  extras: ['Dust jacket', 'Slipcase'],
  views: [],
};

/** Settings read from a file or storage, with a default for anything missing. */
export function withDefaults(settings) {
  const merged = { ...SHARED_DEFAULTS, ...(settings || {}) };
  // Settings saved before data format 4 kept one bindings list that mixed
  // bindings, materials and extras ("Hardcover with dust jacket"); it is
  // sorted into the three lists, beside the default materials and extras.
  if (settings && settings.bindings && !settings.materials) {
    const sorted = sortBindingList(settings.bindings);
    merged.bindings = sorted.bindings;
    merged.materials = [...new Set([...sorted.materials, ...SHARED_DEFAULTS.materials])];
    merged.extras = [...new Set([...sorted.extras, ...SHARED_DEFAULTS.extras])];
  }
  // A lookup added later (HathiTrust, 2026-11-11) is on until someone turns it off.
  return { ...merged, lookups: { ...SHARED_DEFAULTS.lookups, ...merged.lookups } };
}

/** settings.json as text: keys in the order above, pretty-printed, newline at the end. */
export function settingsToFileText(settings) {
  const full = withDefaults(settings);
  const ordered = Object.fromEntries(Object.keys(SHARED_DEFAULTS).map(key => [key, full[key]]));
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * Whether connecting to `wantedRepo` moves this device to another catalog, so
 * its own copy must be emptied first, or the old catalog's records would be
 * sent to the new one. A device never connected keeps its records and sends
 * them; GitHub ignores capitals in repository names, so this does too.
 * @param {string} connectedRepo the repository this device syncs with now ('' if none)
 * @param {string} wantedRepo the repository typed in Settings › Sync
 * @returns {boolean}
 */
export function isAnotherCatalog(connectedRepo, wantedRepo) {
  const connected = (connectedRepo || '').trim().toLowerCase();
  return connected !== '' && connected !== (wantedRepo || '').trim().toLowerCase();
}

/**
 * A link that sets up another device: the catalog, the sync key and the
 * Google Books key, after the "#", which browsers never send to any server.
 * @param {string} appUrl the app's address without its "#" part
 * @param {{ repo: string, key: string, googleBooksKey?: string }} setup
 * @returns {string}
 */
export function setupLink(appUrl, { repo, key, googleBooksKey }) {
  const params = new URLSearchParams({ repo, key });
  if (googleBooksKey) params.set('google', googleBooksKey);
  return `${appUrl}#/connect?${params}`;
}

/**
 * Read a setup link's "#" part, as made by setupLink.
 * @param {string} hash the address's "#" part, such as location.hash
 * @returns {{ repo: string, key: string, googleBooksKey: string } | null} null if it is not a setup link
 */
export function readSetupLink(hash) {
  const match = /^#\/connect\?(.*)$/.exec(hash || '');
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const repo = (params.get('repo') || '').trim();
  const key = (params.get('key') || '').trim();
  if (!repo || !key) return null;
  return { repo, key, googleBooksKey: (params.get('google') || '').trim() };
}

/**
 * The likely data repository for an app served from "<owner>.github.io":
 * "<owner>/my-loci-library-data", the name the setup guide uses. Elsewhere ''.
 * @param {string} hostname such as location.hostname
 * @returns {string}
 */
export function guessDataRepo(hostname) {
  const match = /^([a-z0-9-]+)\.github\.io$/i.exec(hostname || '');
  return match ? `${match[1]}/my-loci-library-data` : '';
}
