// The Zotero companion, against a stand-in for Zotero's web API
// (tests/fake-zotero.mjs) and the sample books. Run with `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newRecord, withField } from '../../core/records.js';
import { connectToZotero } from '../zotero-api.mjs';
import { sendToZotero } from '../zotero-sync.mjs';
import { originalDateText } from '../zotero-items.mjs';
import { fakeZotero } from './fake-zotero.mjs';
import { plato, augustine, confessions, chadwick, loebWorks, loeb36, na28, na28Works, triglotta, triglottaWorks } from '../../core/tests/samples.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-10T12:00:00Z';
const copy = (id, edition, values = {}) => newRecord('copy', id, NOW, { edition, added: '2026-11-10', location: ['Home', 'Office', 'Case 1'], ...values });
const logos = (id, title, cite) => newRecord('edition', id, NOW, { title, contents: [{ work: confessions.id, extent: 'complete', translator: null, pages: null }], medium: 'logos', logosId: `LLS:${id}`, cite, year: 1991 });

// Chadwick's Confessions, the Loeb Plato (an anthology of three dialogues),
// a Logos book marked "cite", one not marked, and a wishlist item.
function sampleRecords() {
  return [plato, augustine, confessions, chadwick, ...loebWorks, loeb36,
    copy('c0py0000000p', chadwick.id), copy('c0py0000000q', loeb36.id),
    logos('l0g0scited01', 'Confessions (Logos, cited)', true), logos('l0g0sn0tc1te', 'Not cited', false),
    newRecord('wishlist', 'w1sh00000001', NOW, { title: 'A wish' })];
}
const setup = (options = {}) => {
  const fake = fakeZotero(options);
  return { fake, zotero: connectToZotero({ userId: '12345', key: 'test-key', fetchFn: fake.fetchFn }), links: { format: 1, collection: null, items: {} } };
};

// The links attached under books (back to Loci), and everything else.
const attachments = fake => [...fake.items.values()].filter(item => item.data.itemType === 'attachment');
const mainItems = fake => [...fake.items.values()].filter(item => item.data.itemType !== 'attachment');

test('physical books and cited Logos books are sent as books only, with only bibliographic data, and a link back to Loci under each', async () => {
  const { fake, zotero, links } = setup();
  const report = await sendToZotero(sampleRecords(), links, zotero);
  assert.match(report[0], /Zotero: 3 new/, 'Chadwick, the Loeb, the cited Logos book');
  assert.equal(fake.byTitle('Not cited').length + fake.byTitle('A wish').length, 0, 'uncited Logos books and wishes never go');
  const [book] = fake.byTitle('Confessions');
  assert.equal(book.data.originalDate, undefined, 'c. 397–400 is not sent: Chicago would print it as "orig. 397"');
  assert.equal(book.data.citationKey, 'Augustine1991', "in Zotero's own Citation Key field");
  assert.ok(!book.data.url && !book.data.archiveLocation && !book.data.extra, 'nothing that Chicago would print, or Better BibTeX export, beyond the book itself');
  assert.equal(book.data.collections.length, 1);
  const [link] = attachments(fake).filter(item => item.data.parentItem === book.key);
  assert.equal(link.data.linkMode, 'linked_url');
  assert.equal(link.data.url, 'https://jakobnath.github.io/my-loci-library/#/book/chadw1ck1991');
  assert.equal(link.data.title, 'My Loci Library · Home › Office › Case 1', 'the shelf in its title');
  assert.equal(attachments(fake).length, 3, 'one under each book');
  assert.equal(fake.byTitle('Phaedo').length, 0, 'no section for a work inside an anthology');
  assert.ok(mainItems(fake).every(item => item.data.itemType === 'book'));
  assert.ok(Object.keys(links.items).every(linkId => !linkId.includes('/')));
  const keys = Object.values(links.items).map(link => link.citationKey);
  assert.equal(new Set(keys).size, keys.length, 'every key is different');
  assert.ok(keys.includes('Augustine1991a'), 'the cited Logos Confessions of the same year gets a suffix');
});

test('a second run sends nothing; a changed shelf renames the link quickly, and the book itself is not touched', async () => {
  const { fake, zotero, links } = setup({ delayMs: 20 });
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const before = fake.calls.length;
  assert.match((await sendToZotero(records, links, zotero))[0], /0 new, 0 updated, 3 unchanged/);
  assert.deepEqual(fake.calls.slice(before), ['GET /collections?limit=100&start=0', 'GET /items?format=versions&includeTrashed=0'], 'only two small checks: the collection, and which items still exist');
  const moved = records.map(record => (record.id === 'c0py0000000p' ? withField(record, 'location', ['Home', 'Study'], NOW) : record));
  const started = Date.now();
  const versionBefore = fake.byTitle('Confessions')[0].version;
  const report = await sendToZotero(moved, links, zotero);
  assert.match(report[0], /0 new, 0 updated/);
  assert.match(report.join(' '), /1 links back to My Loci Library made or renamed/);
  assert.ok(Date.now() - started < 10000, 'under 10 seconds (PLAN.md, speed target)');
  assert.equal(fake.items.get(links.items[chadwick.id].attachment).data.title, 'My Loci Library · Home › Study');
  assert.equal(fake.byTitle('Confessions')[0].version, versionBefore, 'the book item is unchanged');
});

test('nothing is deleted: books given away or removed in Loci are tagged instead', async () => {
  const { fake, zotero, links } = setup();
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const changed = records.map(record => {
    if (record.id === 'c0py0000000p') return withField(record, 'status', 'given away', NOW);
    if (record.id === loeb36.id) return withField(record, 'trashed', '2026-11-10', NOW);
    if (record.id === 'l0g0scited01') return withField(record, 'cite', false, NOW);
    return record;
  });
  await sendToZotero(changed, links, zotero);
  const tags = title => fake.byTitle(title)[0].data.tags.map(tag => tag.tag);
  assert.deepEqual(tags('Confessions'), ['Loci: no longer owned']);
  assert.deepEqual(tags('Euthyphro. Apology. Crito. Phaedo. Phaedrus.'), ['Loci: removed']);
  assert.deepEqual(tags('Confessions (Logos, cited)'), ['Loci: removed']);
  assert.equal(mainItems(fake).length, 3);
  assert.ok(!fake.calls.some(call => call.startsWith('DELETE')));
});

test('on the first run a book already in Zotero is linked and keeps what it holds: only its empty fields are filled, and the differences are reported', async () => {
  const { fake, zotero, links } = setup();
  const key = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '978-0-19-953782-2', publisher: 'OUP', date: '1991',
    extra: 'Citation Key: Augustine1991\nRead for the seminar', tags: [{ tag: 'patristics' }], collections: ['OLDCOLL1'] });
  const report = await sendToZotero(sampleRecords(), links, zotero);
  assert.match(report[0], /Zotero: 2 new, 1 updated/);
  assert.equal(links.items[chadwick.id].key, key, 'linked, not made again');
  const item = fake.items.get(key).data;
  assert.equal(item.publisher, 'OUP', 'what the person entered in Zotero stays');
  assert.ok(item.creators && item.creators.length, 'an empty field is filled');
  assert.equal(item.citationKey, 'Augustine1991', 'the key pinned in Extra moves to the Citation Key field');
  assert.equal(item.extra, 'Read for the seminar', 'the note in Extra stays');
  assert.deepEqual(item.tags, [{ tag: 'patristics' }]);
  assert.deepEqual(item.collections.length, 2, 'its other collection stays');
  assert.ok(report.some(line => line.includes('publisher kept as "OUP"')), 'the difference is reported');
  assert.equal(links.items[chadwick.id].adopted, true, 'remembered, so later runs fill only empty fields too');
});

test('items deleted in Zotero, and a deleted collection, are made again on the next run, with the same keys', async () => {
  const { fake, zotero, links } = setup();
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const keyBefore = links.items[chadwick.id].citationKey;
  for (const key of [...fake.items.keys()]) fake.remove(key);
  fake.removeCollections();
  const report = await sendToZotero(records, links, zotero);
  assert.match(report.join(' '), /3 items were missing in Zotero/);
  assert.match(report[0], /Zotero: 3 new/);
  assert.equal(mainItems(fake).length, 3);
  assert.equal(attachments(fake).length, 3, 'the links under the books are made again too');
  assert.equal(links.items[chadwick.id].citationKey, keyBefore, 'the pinned key stays the same');
  assert.equal(fake.byTitle('Confessions')[0].data.collections[0], links.collection, 'in the new collection');
  assert.match((await sendToZotero(records, links, zotero))[0], /0 new, 0 updated, 3 unchanged/);
});

test('a run stopped part-way keeps what it already sent', async () => {
  const { fake, zotero, links } = setup();
  let saves = 0;
  await sendToZotero(sampleRecords(), links, zotero, { save: () => { saves++; } });
  assert.ok(saves >= 1, 'the link file is saved during the run, not only at the end');
  assert.equal(Object.values(links.items).filter(link => link.key).length, mainItems(fake).length);
});

test('a trial in a test collection never changes an item already in Zotero', async () => {
  const { fake, zotero, links } = setup();
  const key = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '9780199537822', date: '1991', collections: ['OLDCOLL1'] });
  const before = structuredClone(fake.items.get(key));
  await sendToZotero(sampleRecords(), links, zotero, { collectionName: 'Loci test' });
  assert.deepEqual(fake.items.get(key), before);
  assert.ok(Object.values(links.items).every(link => link.key !== key));
});

test('on the first run only a real match is linked: a book, with an ISBN in common and an agreeing title, once', async () => {
  const { fake, zotero, links } = setup();
  // A two-volume set whose ISBN field also holds Chadwick's ISBN, and a section with it: neither is Confessions.
  const set = fake.add({ itemType: 'book', title: 'Loci theologici 1', ISBN: '978-0-7586-1546-6 978-0-19-953782-2', collections: [] });
  const section = fake.add({ itemType: 'bookSection', title: 'Confessions', ISBN: '9780199537822', collections: [] });
  const kept = [structuredClone(fake.items.get(set)), structuredClone(fake.items.get(section))];
  const copies = [];
  await sendToZotero(sampleRecords(), links, zotero, { keepBefore: item => copies.push(item.key) });
  assert.deepEqual([fake.items.get(set), fake.items.get(section)], kept, 'neither is touched');
  const real = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '978-0-19-953782-2 0199537828', citationKey: 'Augustine1991', collections: [] });
  const { zotero: second, links: fresh } = setup();
  const fake2 = fakeZotero();
  fake2.items.set(real, fake.items.get(real));
  const run = connectToZotero({ userId: '12345', key: 'test-key', fetchFn: fake2.fetchFn });
  await sendToZotero(sampleRecords(), fresh, run, { keepBefore: item => copies.push(item.key) });
  assert.equal(fresh.items[chadwick.id].key, real, 'the real Confessions, with several ISBNs in its field, is linked');
  assert.equal(fresh.items[chadwick.id].citationKey, 'Augustine1991', "Zotero's own Citation Key field is kept");
  assert.deepEqual(copies, [real], 'a full copy was kept before it was changed');
  assert.equal(Object.values(fresh.items).filter(link => link.key === real).length, 1, 'linked to one Loci book only');
  void second;
});

test('a Bible and the Book of Concord are each sent as one book, like every other book', async () => {
  const { fake, zotero, links } = setup();
  await sendToZotero([...na28Works, na28, copy('c0py0000000r', na28.id), ...triglottaWorks, triglotta, copy('c0py0000000s', triglotta.id)], links, zotero);
  assert.equal(fake.byTitle('Novum Testamentum Graece').length, 1);
  assert.equal(mainItems(fake).length, 2, 'no "Romans, in NA28", and no section per confession');
});

test('a volume of a set is sent as a book with its volume number, and the volume title in Extra', async () => {
  const { fake, zotero, links } = setup();
  const volume = { ...loeb36, set: 'Loeb Classical Library', volume: '36', title: 'Loeb Classical Library', subtitle: 'Volume 36: Euthyphro. Apology. Crito. Phaedo. Phaedrus.' };
  await sendToZotero([...loebWorks, volume, plato, copy('c0py0000000t', loeb36.id)], links, zotero);
  const [book] = mainItems(fake);
  assert.equal(mainItems(fake).length, 1);
  assert.equal(book.data.volume, '36');
  assert.equal(book.data.extra, 'volume-title: Euthyphro. Apology. Crito. Phaedo. Phaedrus.');
});

test('book sections sent by earlier versions are tagged "Loci: removed", never deleted or made again', async () => {
  const { fake, zotero, links } = setup();
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  // As an earlier version left things: sections of the Loeb's works, and one of a work since taken out of it.
  const section = title => fake.add({ itemType: 'bookSection', title, bookTitle: loeb36.title, tags: [{ tag: 'Plato' }], collections: [links.collection] });
  const old = { Phaedo: section('Phaedo'), Phaedrus: section('Phaedrus'), Crito: section('Crito') };
  const sectionId = workId => loeb36.id + '/' + workId;
  links.items[sectionId(loebWorks[1].id)] = { key: old.Phaedo, citationKey: 'Plato1914', sent: 'earlier', related: true };
  links.items[sectionId(loebWorks[2].id)] = { key: old.Phaedrus, citationKey: 'Plato1914a', sent: 'earlier', related: true };
  links.items[sectionId('cr1t0gone001')] = { key: old.Crito, citationKey: 'Plato1914b', sent: 'earlier', related: true };
  const report = await sendToZotero(records, links, zotero);
  assert.match(report[0], /0 new, 3 updated, 3 unchanged/);
  for (const key of Object.values(old)) assert.deepEqual(fake.items.get(key).data.tags, [{ tag: 'Plato' }, { tag: 'Loci: removed' }], 'its own tags kept');
  assert.equal(fake.byTitle('Euthyphro').length, 0, 'no section is made for a work that had none');
  assert.ok(!fake.calls.some(call => call.startsWith('DELETE')));
  assert.match((await sendToZotero(records, links, zotero))[0], /0 new, 0 updated, 6 unchanged/, 'tagged once');
  // A section deleted by hand in Zotero is not made again.
  fake.remove(old.Phaedo);
  const later = await sendToZotero(records, links, zotero);
  assert.match(later[0], /0 new, 0 updated, 5 unchanged/);
  assert.doesNotMatch(later.join(' '), /missing in Zotero/);
  assert.equal(fake.byTitle('Phaedo').length, 0);
  assert.equal(links.items[sectionId(loebWorks[1].id)].citationKey, 'Plato1914', 'its key is still held, so it is never given to another item');
});

test('the companion has matching .cmd and .sh launchers', () => {
  const cmd = readFileSync(join(here, '..', 'loci-zotero.cmd'), 'utf8');
  const sh = readFileSync(join(here, '..', 'loci-zotero.sh'), 'utf8');
  assert.ok(cmd.includes('cd /d "%~dp0"') && cmd.includes('node loci-zotero.mjs %*'));
  assert.ok(sh.startsWith('#!/bin/sh') && sh.includes('node loci-zotero.mjs "$@"'));
});

test("a call number already in Zotero stays on a book that was there before; a book the companion made takes Loci's", async () => {
  const { fake, zotero, links } = setup();
  const key = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '9780199537822', date: '1991', callNumber: 'BR65 .A6 1991', collections: [] });
  await sendToZotero(sampleRecords(), links, zotero);
  assert.equal(fake.items.get(key).data.callNumber, 'BR65 .A6 1991', 'not emptied when Loci has none');
  const numbered = withField(chadwick, 'identifiers', { lccn: '2008491261', oclc: null, lcc: 'BR65.A6 E5 2008', ddc: null }, '2026-11-12T09:00:00Z');
  await sendToZotero(sampleRecords().map(record => (record.id === chadwick.id ? numbered : record)), links, zotero);
  assert.equal(fake.items.get(key).data.callNumber, 'BR65 .A6 1991', "Zotero's own stays on a book that was there before");
  const fresh = setup();
  await sendToZotero(sampleRecords().map(record => (record.id === chadwick.id ? numbered : record)), fresh.links, fresh.zotero);
  assert.equal(fresh.fake.byTitle('Confessions')[0].data.callNumber, 'BR65.A6 E5 2008', "a book the companion made takes Loci's");
});

test("only an exact original year goes to Zotero's Original Date field, and a date typed there by hand stays", async () => {
  const exact = withField(confessions, 'datings', [{ text: '397', earliest: 397, latest: 397, certainty: 'exact', kind: null, note: '', working: true }], '2026-11-12T09:00:00Z');
  const records = sampleRecords().map(record => (record.id === confessions.id ? exact : record));
  const first = setup();
  await sendToZotero(records, first.links, first.zotero);
  assert.equal(first.fake.byTitle('Confessions')[0].data.originalDate, '397');
  assert.equal(originalDateText({ 'date-parts': [[-385]] }), '385 BC');
  assert.equal(originalDateText({ 'date-parts': [[1530], [1559]] }), '', 'a span is not sent');
  const { fake, zotero, links } = setup();
  const key = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '9780199537822', date: '1991', originalDate: 'ca. 397', collections: [] });
  await sendToZotero(sampleRecords(), links, zotero);
  assert.equal(fake.items.get(key).data.originalDate, 'ca. 397', 'not emptied when Loci has no exact year');
});

test('an item merged into another in Zotero is not made again: the item kept is linked, and only its empty fields are filled', async () => {
  const { fake, zotero, links } = setup();
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const made = links.items[chadwick.id].key;
  // A person merges the companion's Confessions into their own older item: Zotero keeps theirs and trashes ours.
  const theirs = fake.add({ itemType: 'book', title: 'Confessions', publisher: 'Their own publisher', citationKey: 'augustineConfessions', relations: { 'dc:replaces': [zotero.uri(made)] }, collections: [], tags: [] });
  fake.remove(made);
  const report = await sendToZotero(records, links, zotero);
  assert.match(report.join(' '), /1 items had been merged into another in Zotero/);
  assert.doesNotMatch(report.join(' '), /missing in Zotero/);
  assert.match(report[0], /0 new/);
  assert.equal(links.items[chadwick.id].key, theirs);
  assert.equal(links.items[chadwick.id].citationKey, 'augustineConfessions', "the kept item's key is the one cited");
  assert.equal(fake.items.get(theirs).data.publisher, 'Their own publisher', 'nothing they entered is replaced');
  assert.ok(fake.items.get(theirs).data.collections.includes(links.collection));
});

test('more than 100 collections are all looked through', async () => {
  const { fake, zotero } = setup();
  const pages = [];
  const many = Array.from({ length: 150 }, (_, i) => ({ key: `C${i}`, data: { name: i === 120 ? 'My Loci Library' : `Collection ${i}`, parentCollection: false } }));
  const paging = async (url, options) => {
    const match = url.match(/\/collections\?limit=100&start=(\d+)/);
    if (!match) return fake.fetchFn(url, options);
    pages.push(Number(match[1]));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => many.slice(Number(match[1]), Number(match[1]) + 100) };
  };
  const paged = connectToZotero({ userId: '12345', key: 'test-key', fetchFn: paging });
  assert.equal(await paged.collection('My Loci Library'), 'C120');
  assert.deepEqual(pages, [0, 100]);
  assert.ok(zotero);
});
