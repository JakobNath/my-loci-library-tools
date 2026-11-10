// Zotero's web API (https://www.zotero.org/support/dev/web_api/v3/start),
// the only file of the Zotero tool that talks to Zotero. Zotero 7's local API
// on the laptop can only read, so writes go through the web API, and Zotero
// on the laptop picks them up with its own sync, usually within seconds.

const API = 'https://api.zotero.org';
const BATCH = 50; // the most items Zotero accepts in one request

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * @param {{ userId: string, key: string, fetchFn?: typeof fetch }} options key: a Zotero API key with write access
 */
export function connectToZotero({ userId, key, fetchFn = fetch }) {
  async function call(method, path, { body, headers = {} } = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetchFn(`${API}/users/${userId}${path}`, {
        method,
        headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      // Zotero asks clients to slow down with these; the tool waits as asked and tries again.
      const pause = Number(response.headers.get('retry-after') || response.headers.get('backoff') || 0);
      if (response.status === 429 || response.status === 503) { await wait((pause || 5) * 1000); continue; }
      if (response.status === 403) throw new Error('Zotero refused the key. Make a key with write access at zotero.org/settings/keys and put it in config.json.');
      if (response.status === 412) { const error = new Error('Zotero has a newer version of this item.'); error.status = 412; throw error; }
      if (!response.ok) throw new Error(`Zotero answered ${response.status} to ${method} ${path}.`);
      if (pause) await wait(pause * 1000);
      return response.status === 204 ? null : response.json();
    }
    throw new Error('Zotero kept asking to wait; try again later.');
  }

  return {
    /** The collection with this name, made if missing. Returns its key. */
    async collection(name) {
      const all = await call('GET', '/collections?limit=100');
      const found = all.find(item => item.data.name === name && !item.data.parentCollection);
      if (found) return found.key;
      const made = await call('POST', '/collections', { body: [{ name, parentCollection: false }] });
      return made.successful['0'].key;
    },

    /** Every book and book section in the library (for linking on the first run), page by page. */
    async allBooks() {
      const items = [];
      for (let start = 0; ; start += 100) {
        const page = await call('GET', `/items?itemType=book%20||%20bookSection&limit=100&start=${start}`);
        items.push(...page);
        if (page.length < 100) return items;
      }
    },

    /** One item: { key, version, data }. */
    item: itemKey => call('GET', `/items/${itemKey}`),

    /**
     * Make new items, up to 50 per request.
     * @returns {Promise<string[]>} their keys, in order (null for one Zotero refused)
     */
    async create(datas) {
      const keys = [];
      for (let i = 0; i < datas.length; i += BATCH) {
        const answer = await call('POST', '/items', { body: datas.slice(i, i + BATCH) });
        datas.slice(i, i + BATCH).forEach((_, j) => keys.push(answer.successful[String(j)] ? answer.successful[String(j)].key : null));
      }
      return keys;
    },

    /** The address Zotero uses for an item in relations between items. */
    uri: itemKey => `http://zotero.org/users/${userId}/items/${itemKey}`,

    /** Change some fields of an item, if it is still at `version`. */
    update: (itemKey, version, data) => call('PATCH', `/items/${itemKey}`, { body: data, headers: { 'If-Unmodified-Since-Version': String(version) } }),
  };
}
