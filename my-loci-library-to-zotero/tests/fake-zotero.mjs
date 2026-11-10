// A small stand-in for Zotero's web API, for the tests: it keeps items and
// collections in memory and answers the few requests the tool makes. Like
// Zotero, it refuses a change to an item that is not at the version the
// change was based on (status 412). It has no way to delete anything.

export function fakeZotero({ delayMs = 0 } = {}) {
  const items = new Map(); // key → { key, version, data }
  const collections = [];
  const calls = [];
  let version = 0;
  let counter = 0;
  const newKey = () => `K${String(++counter).padStart(7, '0')}`;

  const answer = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  });

  async function fetchFn(url, options = {}) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    const method = options.method || 'GET';
    const path = url.replace(/^https:\/\/api\.zotero\.org\/users\/\d+/, '');
    calls.push(`${method} ${path}`);
    const body = options.body ? JSON.parse(options.body) : null;
    let match;
    if (method === 'GET' && path.startsWith('/collections')) return answer(200, collections);
    if (method === 'POST' && path === '/collections') {
      const key = newKey();
      collections.push({ key, data: { key, ...body[0] } });
      return answer(200, { successful: { 0: { key } } });
    }
    if (method === 'GET' && (match = path.match(/^\/items\?.*start=(\d+)/))) {
      return answer(200, [...items.values()].slice(Number(match[1]), Number(match[1]) + 100));
    }
    if (method === 'GET' && (match = path.match(/^\/items\/(\w+)$/))) {
      const item = items.get(match[1]);
      return item ? answer(200, structuredClone(item)) : answer(404, {});
    }
    if (method === 'POST' && path === '/items') {
      const successful = {};
      body.forEach((data, i) => {
        const key = newKey();
        items.set(key, { key, version: ++version, data: { key, ...data } });
        successful[i] = { key };
      });
      return answer(200, { successful, failed: {} });
    }
    if (method === 'PATCH' && (match = path.match(/^\/items\/(\w+)$/))) {
      const item = items.get(match[1]);
      if (Number(options.headers['If-Unmodified-Since-Version']) !== item.version) return answer(412, {});
      Object.assign(item.data, body);
      item.version = ++version;
      return answer(204, null);
    }
    return answer(404, { message: `Not handled by the fake: ${method} ${path}` });
  }

  return {
    fetchFn,
    calls,
    items,
    /** Put an item straight into the library (as if added in Zotero by hand). */
    add(data) { const key = newKey(); items.set(key, { key, version: ++version, data: { key, ...data } }); return key; },
    byTitle: title => [...items.values()].filter(item => item.data.title === title),
  };
}
