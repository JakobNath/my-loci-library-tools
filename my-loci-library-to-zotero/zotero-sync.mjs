// One run of the Zotero companion: send every changed book to Zotero, one
// way. Which Loci record is which Zotero item, each item's pinned citation
// key, and a fingerprint of what was last sent are kept in the data
// repository, in integrations/zotero-links.json; only books whose
// fingerprint changed are sent again. Nothing is ever deleted from Zotero.

import { createHash } from 'node:crypto';
import { buildLibrary } from '../core/library.js';
import { freeCitationKey, citationKeyBase } from '../core/zotero.js';
import { normalizeForSearch } from '../core/search.js';
import { isbn13 } from '../core/entry.js';
import { itemsFor, isSent, extraWithout, pinnedKey, lociTags, TAG_GONE, TAG_REMOVED } from './zotero-items.mjs';

const fingerprint = value => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const LOCI_TAGS = [TAG_GONE, TAG_REMOVED];

export const MAIN_COLLECTION = 'My Loci Library';

// Every ISBN in a Zotero ISBN field, as 13 digits: the field may hold several
// ("978-0-7586-1546-6 978-0-7586-1547-3" for a two-volume set).
const isbnsOf = data => (String(data.ISBN || '').match(/\d[\d-]{8,15}[\dX]/gi) || []).map(isbn13).filter(Boolean);
const plainTitle = text => normalizeForSearch(String(text || '')).replace(/[^a-z0-9]/g, '');
// Titles agree when one is the other, or the other with its subtitle ("Confessions" and "Confessions: A New Translation").
const sameTitle = (a, b) => { const x = plainTitle(a); const y = plainTitle(b); return Boolean(x && y && (x.startsWith(y) || y.startsWith(x))); };
const yearOf = data => String(data.date || '').match(/\d{4}/)?.[0] || '';

/**
 * The book already in Zotero that is this one, if any: a book (never a book
 * section) that shares an ISBN and whose title agrees, or, when neither has an
 * ISBN, has the same title and year. An item is linked to one Loci book only.
 */
function findExisting(item, books, used) {
  if (item.data.itemType !== 'book') return null;
  const ours = isbn13(item.data.ISBN);
  return books.find(book => !used.has(book.key) && book.data.itemType === 'book' && sameTitle(item.data.title, book.data.title) && (ours
    ? isbnsOf(book.data).includes(ours)
    : !isbnsOf(book.data).length && plainTitle(item.data.title) === plainTitle(book.data.title) && yearOf(item.data) === yearOf(book.data))) || null;
}

/**
 * @param {object[]} records every record in the data repository
 * @param {{ collection: string|null, items: Record<string, { key: string, citationKey: string, sent: string }> }} links integrations/zotero-links.json (changed in place)
 * @param {ReturnType<import('./zotero-api.mjs').connectToZotero>} zotero
 * @param {{ collectionName?: string, appUrl?: string, linkExisting?: boolean, onProgress?: (text: string) => void, save?: () => void, keepBefore?: (item: object) => void }} options
 *   linkExisting: on a first run, link books already in Zotero instead of adding them
 *   again; only for the main collection, so a trial in a test collection never
 *   changes an item that was already there;
 *   onProgress: told what is happening, for the command line; save: keeps the link file,
 *   called after each batch, so a run that is stopped part-way loses nothing;
 *   keepBefore: given a full copy of each existing item before it is first changed
 * @returns {Promise<string[]>} the report, one line each
 */
export async function sendToZotero(records, links, zotero, { collectionName = MAIN_COLLECTION, appUrl, linkExisting = collectionName === MAIN_COLLECTION, onProgress = () => {}, save = () => {}, keepBefore = () => {} } = {}) {
  const report = [];
  const firstRun = !Object.keys(links.items).length;
  onProgress(`Connecting to Zotero (collection "${collectionName}")…`);
  // The collection is looked up every run: if it was deleted in Zotero it is made again,
  // and every item is sent again so it joins the new one.
  const collection = await zotero.collection(collectionName);
  if (links.collection && links.collection !== collection) for (const link of Object.values(links.items)) link.sent = null;
  links.collection = collection;
  // Items deleted in Zotero (or moved to its trash) are sent again, keeping their pinned keys.
  if (!firstRun) {
    const present = await zotero.presentKeys();
    const missing = Object.entries(links.items).filter(([, link]) => link.key && !present.has(link.key));
    for (const [linkId, link] of missing) links.items[linkId] = { citationKey: link.citationKey };
    // A link under a book that was deleted by hand is made again too.
    for (const link of Object.values(links.items)) if (link.attachment && !present.has(link.attachment)) { delete link.attachment; delete link.attachmentTitle; }
    if (missing.length) report.push(`${missing.length} items were missing in Zotero (deleted, or in its trash) and are sent again.`);
  }
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
  // Keys already pinned in the library are never handed out again.
  const existing = { books: [], used: new Set(), keys: new Set() };
  if (firstRun) {
    onProgress('Reading the books already in Zotero…');
    for (const item of await zotero.allBooks()) {
      if (linkExisting) existing.books.push(item);
      const key = pinnedKey(item.data);
      if (key) existing.keys.add(key);
    }
  }
  const taken = new Set([...existing.keys, ...Object.values(links.items).map(link => link.citationKey)]);

  const toCreate = [];
  let unchanged = 0;
  let updated = 0;
  onProgress('Comparing with what was sent last time…');
  for (const item of wanted) {
    const known = links.items[item.linkId];
    const link = known && known.key ? known : null; // an item that exists in Zotero
    if (item.tagOnly) {
      if (!link) continue; // gone from Zotero as well: nothing to tag
      const sent = fingerprint(item.tags);
      if (link.sent === sent) { unchanged++; continue; }
      await mergeInto(zotero, link.key, { tags: item.tags }, links.collection);
      link.sent = sent;
      updated++;
      save();
      continue;
    }
    const match = !link && firstRun ? findExisting(item, existing.books, existing.used) : null;
    if (match) existing.used.add(match.key);
    const citationKey = known ? known.citationKey : (match && pinnedKey(match.data)) || freeCitationKey(citationKeyBase(item.csl, item.year), taken);
    taken.add(citationKey);
    const data = { ...item.data, citationKey };
    const sent = fingerprint([data, item.tags]);
    if (link && link.sent === sent) { unchanged++; continue; }
    if (link || match) {
      const key = link ? link.key : match.key;
      const differences = await mergeInto(zotero, key, { ...data, tags: item.tags }, links.collection, match && !link ? keepBefore : () => {});
      if (match && !link) report.push(...differences.map(text => `  ${item.data.title}: ${text}`));
      links.items[item.linkId] = { ...known, key, citationKey, sent };
      updated++;
      save();
    } else {
      toCreate.push({ item, citationKey, sent, data });
    }
  }

  // New items go 50 at a time (as many as Zotero takes in one request), and are saved after each batch.
  const made = [];
  for (let i = 0; i < toCreate.length; i += 50) {
    onProgress(`Sending new items: ${i + 1}–${Math.min(i + 50, toCreate.length)} of ${toCreate.length}…`);
    const batch = toCreate.slice(i, i + 50);
    const keys = await zotero.create(batch.map(({ data, item }) => ({ ...data, collections: [links.collection], tags: item.tags.map(tag => ({ tag })) })));
    batch.forEach(({ item, citationKey, sent }, j) => { if (keys[j]) links.items[item.linkId] = { key: keys[j], citationKey, sent }; });
    made.push(...keys);
    save();
  }
  const failed = made.filter(key => !key).length;

  // Each section of an anthology is marked as related to the anthology's own item.
  for (const [linkId, link] of Object.entries(links.items)) {
    const book = links.items[linkId.split('/')[0]];
    if (!linkId.includes('/') || link.related || !link.key || !book || !book.key) continue;
    const current = await zotero.item(link.key);
    await zotero.update(link.key, current.version, { relations: { ...(current.data.relations || {}), 'dc:relation': zotero.uri(book.key) } });
    link.related = true;
    save();
  }

  // The link under each book, back to it in Loci and titled with its shelf: made once, renamed when the shelf changes.
  let attached = 0;
  for (const item of wanted) {
    const link = links.items[item.linkId];
    if (!item.attachment || !link || !link.key) continue;
    const title = item.attachment.title;
    if (link.attachment && link.attachmentTitle === title) continue;
    if (link.attachment) {
      const current = await zotero.item(link.attachment);
      await zotero.update(link.attachment, current.version, { title, url: item.attachment.url });
    } else {
      const [key] = await zotero.create([{ itemType: 'attachment', linkMode: 'linked_url', parentItem: link.key, title, url: item.attachment.url, contentType: '', charset: '', note: '', tags: [], relations: {} }]);
      if (!key) continue;
      link.attachment = key;
    }
    link.attachmentTitle = title;
    attached++;
    save();
  }
  if (attached) report.push(`${attached} links back to My Loci Library made or renamed (their titles show the shelf).`);

  report.unshift(`Zotero: ${made.length - failed} new, ${updated} updated, ${unchanged} unchanged${failed ? `, ${failed} refused by Zotero (run again)` : ''}.`);
  if (firstRun && report.length > 1) report.splice(1, 0, 'Books already in Zotero were linked; where their data differed, Loci\'s was written:');
  return report;
}

/**
 * Bring an existing item up to date: our fields written, other tags and other
 * collections kept, and anything the first version of the companion put in URL,
 * Loc. in Archive or Extra taken out again. Returns what differed, in words.
 */
async function mergeInto(zotero, key, ours, collection, keepBefore = () => {}) {
  const current = await zotero.item(key);
  keepBefore(current);
  const differences = [];
  const change = {};
  for (const [field, value] of Object.entries(ours)) {
    if (field === 'tags' || field === 'itemType' || field === 'extra') continue; // an item's type is never changed
    if (JSON.stringify(current.data[field] ?? '') !== JSON.stringify(value)) {
      change[field] = value;
      if (current.data[field]) differences.push(`${field} was ${JSON.stringify(current.data[field])}`);
    }
  }
  if (String(current.data.url || '').includes('/#/book/')) { change.url = ''; change.archiveLocation = ''; }
  // Extra: our one line (a volume's own title), and every line a person wrote.
  const extra = [ours.extra || '', extraWithout(current.data.extra)].filter(Boolean).join('\n');
  if (extra !== (current.data.extra || '')) change.extra = extra;
  const tags = [...(current.data.tags || []).filter(tag => !LOCI_TAGS.includes(tag.tag)), ...ours.tags.map(tag => ({ tag }))];
  if (JSON.stringify(tags) !== JSON.stringify(current.data.tags || [])) change.tags = tags;
  if (!(current.data.collections || []).includes(collection)) change.collections = [...(current.data.collections || []), collection];
  if (Object.keys(change).length) await zotero.update(key, current.version, change);
  return differences;
}
