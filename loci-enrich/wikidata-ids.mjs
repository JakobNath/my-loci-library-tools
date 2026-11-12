// Checking stored Wikidata IDs again (SOURCES.md, "Wikidata"): Wikidata
// merges items that turn out to be the same, and the old item then points to
// the new one. loci-enrich asks about every stored ID once every 90 days, in
// a few large queries, stores the new ID of a merged item (it is the same
// work by Wikidata's own record), and reports an ID that no longer exists
// without changing anything.

import { idsQuery, readIdChecks } from '../core/wikidata.js';
import { withField } from '../core/records.js';
import { ADDRESSES, IDENTITY } from './sources.mjs';

// Wikidata's vocabularies, written out because the new query service adds none by itself.
const PREFIXES = `PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wikibase: <http://wikiba.se/ontology#>`;
const BATCH = 200; // IDs per query
const TIMEOUT = 60000; // milliseconds

/**
 * @param {object[]} works work records with a Wikidata ID
 * @param {{ fetchFn: typeof fetch, now: string }} options
 * @returns {Promise<{ changed: object[], lines: string[] }>} the works whose ID was updated, and the report's lines
 */
export async function checkWikidataIds(works, { fetchFn, now }) {
  const ids = [...new Set(works.map(work => work.wikidata).filter(Boolean))];
  const changes = new Map();
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const response = await fetchFn(ADDRESSES.wikidata, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': IDENTITY },
      body: new URLSearchParams({ query: idsQuery(batch, PREFIXES) }).toString(),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!response.ok) throw new Error(`Wikidata answered ${response.status}; the IDs are checked again on the next run`);
    for (const [id, change] of readIdChecks(await response.json(), batch)) changes.set(id, change);
  }
  const changed = [];
  const lines = [];
  for (const work of works) {
    const change = changes.get(work.wikidata);
    if (!change) continue;
    if (change.mergedInto) {
      changed.push(withField(work, 'wikidata', change.mergedInto, now));
      lines.push(`  ${work.title}: ${work.wikidata} was merged into ${change.mergedInto}; the new ID is stored.`);
    } else {
      lines.push(`  ${work.title}: ${work.wikidata} is no longer on Wikidata; nothing was changed. Check the work's ID by hand.`);
    }
  }
  return { changed, lines };
}
