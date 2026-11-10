// One run of the Zotero companion: send every changed book to Zotero, one
// way. Which Loci record is which Zotero item, each item's pinned citation
// key, and a fingerprint of what was last sent are kept in the data
// repository, in integrations/zotero-links.json; only books whose
// fingerprint changed are sent again. Nothing is ever deleted from Zotero.

import { createHash } from 'node:crypto';
import { buildLibrary } from '../core/library.js';
import { freeCitationKey, citationKeyBase } from '../core/zotero.js';
import { normalizeForSearch } from '../core/search.js';
import { itemsFor, isSent, extraWith, pinnedKey, lociTags, TAG_GONE, TAG_REMOVED } from './zotero-items.mjs';

const fingerprint = value => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const LOCI_TAGS = [TAG_GONE, TAG_REMOVED];

// A book in Zotero matches one of ours by ISBN, or by title and year.
const isbnOf = data => String(data.ISBN || '').replace(/[^0-9X]/gi, '').slice(-13);
const titleYear = data => `${normalizeForSearch(data.title || '')}|${String(data.date || '').match(/\d{4}/)?.[0] || ''}`;

/**
 * @param {object[]} records every record in the data repository
 * @param {{ collection: string|null, items: Record<string, { key: string, citationKey: string, sent: string }> }} links integrations/zotero-links.json (changed in place)
 * @param {ReturnType<import('./zotero-api.mjs').connectToZotero>} zotero
 * @param {{ collectionName?: string, appUrl?: string }} options
 * @returns {Promise<string[]>} the report, one line each
 */
export async function sendToZotero(records, links, zotero, { collectionName = 'My Loci Library', appUrl } = {}) {
  const report = [];
  const firstRun = !Object.keys(links.items).length;
  links.collection = links.collection || await zotero.collection(collectionName);
  const library = buildLibrary(records);
  const trashed = records.filter(record => record.type === 'edition' && record.trashed);

  // Everything that should be in Zotero now, with its Loci tags.
  const wanted = [];
  for (const entry of library.entries) {
    if (isSent(entry.edition)) for (const item of itemsFor(entry, library, { appUrl })) wanted.push({ ...item, tags: lociTags(entry, false) });
    // A Logos book whose "cite" was turned off stays in Zotero (with its sections), tagged as removed.
    else for (const linkId of Object.keys(links.items).filter(id => id === entry.id || id.startsWith(`${entry.id}/`))) wanted.push({ linkId, tagOnly: true, tags: [TAG_REMOVED] });
  }
  for (const edition of trashed) {
    for (const linkId of Object.keys(links.items).filter(id => id === edition.id || id.startsWith(`${edition.id}/`))) wanted.push({ linkId, tagOnly: true, tags: [TAG_REMOVED] });
  }

  // On the first run, books already in Zotero are linked rather than made again.
  const existing = { byIsbn: new Map(), byTitle: new Map(), keys: new Set() };
  if (firstRun) {
    for (const item of await zotero.allBooks()) {
      if (isbnOf(item.data)) existing.byIsbn.set(isbnOf(item.data), item);
      existing.byTitle.set(titleYear(item.data), item);
      const key = pinnedKey(item.data.extra);
      if (key) existing.keys.add(key);
    }
  }
  const taken = new Set([...existing.keys, ...Object.values(links.items).map(link => link.citationKey)]);

  const toCreate = [];
  let unchanged = 0;
  let updated = 0;
  for (const item of wanted) {
    const link = links.items[item.linkId];
    if (item.tagOnly) {
      const sent = fingerprint(item.tags);
      if (link.sent === sent) { unchanged++; continue; }
      await mergeInto(zotero, link.key, { tags: item.tags }, links.collection);
      link.sent = sent;
      updated++;
      continue;
    }
    const match = !link && firstRun ? existing.byIsbn.get(isbnOf(item.data)) || existing.byTitle.get(titleYear(item.data)) : null;
    const citationKey = link ? link.citationKey : (match && pinnedKey(match.data.extra)) || freeCitationKey(citationKeyBase(item.csl, item.year), taken);
    taken.add(citationKey);
    const data = { ...item.data, extraLines: { originalDate: item.originalDate, citationKey } };
    const sent = fingerprint([data, item.tags]);
    if (link && link.sent === sent) { unchanged++; continue; }
    if (link || match) {
      const key = link ? link.key : match.key;
      const differences = await mergeInto(zotero, key, { ...data, tags: item.tags }, links.collection);
      if (match && !link) report.push(...differences.map(text => `  ${item.data.title}: ${text}`));
      links.items[item.linkId] = { key, citationKey, sent };
      updated++;
    } else {
      toCreate.push({ item, citationKey, sent, data });
    }
  }

  const made = await zotero.create(toCreate.map(({ data, item }) => ({
    ...withoutExtraLines(data), extra: extraWith('', data.extraLines), collections: [links.collection], tags: item.tags.map(tag => ({ tag })),
  })));
  toCreate.forEach(({ item, citationKey, sent }, i) => { if (made[i]) links.items[item.linkId] = { key: made[i], citationKey, sent }; });
  const failed = made.filter(key => !key).length;

  // Each section of an anthology is marked as related to the anthology's own item.
  for (const [linkId, link] of Object.entries(links.items)) {
    const book = links.items[linkId.split('/')[0]];
    if (!linkId.includes('/') || link.related || !book) continue;
    const current = await zotero.item(link.key);
    await zotero.update(link.key, current.version, { relations: { ...(current.data.relations || {}), 'dc:relation': zotero.uri(book.key) } });
    link.related = true;
  }

  report.unshift(`Zotero: ${made.length - failed} new, ${updated} updated, ${unchanged} unchanged${failed ? `, ${failed} refused by Zotero (run again)` : ''}.`);
  if (firstRun && report.length > 1) report.splice(1, 0, 'Books already in Zotero were linked; where their data differed, Loci\'s was written:');
  return report;
}

const withoutExtraLines = ({ extraLines, ...data }) => data;

/**
 * Bring an existing item up to date: our fields written, Extra's other lines,
 * other tags and other collections kept. Returns what differed, in words.
 */
async function mergeInto(zotero, key, ours, collection) {
  const current = await zotero.item(key);
  const differences = [];
  const change = {};
  for (const [field, value] of Object.entries(withoutExtraLines(ours))) {
    if (field === 'tags') continue;
    if (JSON.stringify(current.data[field] ?? '') !== JSON.stringify(value)) {
      change[field] = value;
      if (field !== 'url' && field !== 'archiveLocation' && current.data[field]) differences.push(`${field} was ${JSON.stringify(current.data[field])}`);
    }
  }
  if (ours.extraLines) {
    const extra = extraWith(current.data.extra, ours.extraLines);
    if (extra !== (current.data.extra || '')) change.extra = extra;
  }
  const tags = [...(current.data.tags || []).filter(tag => !LOCI_TAGS.includes(tag.tag)), ...ours.tags.map(tag => ({ tag }))];
  if (JSON.stringify(tags) !== JSON.stringify(current.data.tags || [])) change.tags = tags;
  if (!(current.data.collections || []).includes(collection)) change.collections = [...(current.data.collections || []), collection];
  if (Object.keys(change).length) await zotero.update(key, current.version, change);
  return differences;
}
