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
import { isBible } from '../../core/bible.js';
import { buildLibrary } from '../../core/library.js';

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

test('physical books, cited Logos books and anthology sections are sent with only bibliographic data, and a link back to Loci under each book', async () => {
  const { fake, zotero, links } = setup();
  const report = await sendToZotero(sampleRecords(), links, zotero);
  assert.match(report[0], /Zotero: 6 new/, 'Chadwick, the Loeb and its 3 sections, the cited Logos book');
  assert.equal(fake.byTitle('Not cited').length + fake.byTitle('A wish').length, 0, 'uncited Logos books and wishes never go');
  const [book] = fake.byTitle('Confessions');
  assert.equal(book.data.originalDate, undefined, 'c. 397–400 is not sent: Chicago would print it as "orig. 397"');
  assert.equal(book.data.citationKey, 'Augustine1991', "in Zotero's own Citation Key field");
  assert.ok(!book.data.url && !book.data.archiveLocation && !book.data.extra, 'nothing that Chicago would print, or Better BibTeX export, beyond the book itself');
  assert.equal(fake.byTitle('Phaedo')[0].data.creators[0].name, 'Plato');
  assert.deepEqual(fake.byTitle('Phaedo')[0].data.creators.filter(person => person.creatorType === 'translator').map(person => person.lastName), ['Fowler'], "the volume's translator, for each work in it");
  assert.equal(book.data.collections.length, 1);
  const [link] = attachments(fake).filter(item => item.data.parentItem === book.key);
  assert.equal(link.data.linkMode, 'linked_url');
  assert.equal(link.data.url, 'https://jakobnath.github.io/my-loci-library/#/book/chadw1ck1991');
  assert.equal(link.data.title, 'My Loci Library · Home › Office › Case 1', 'the shelf in its title');
  assert.equal(attachments(fake).length, 3, 'one under each book, none under sections');
  const [section] = fake.byTitle('Phaedo');
  assert.equal(section.data.itemType, 'bookSection');
  assert.equal(section.data.bookTitle, 'Euthyphro. Apology. Crito. Phaedo. Phaedrus.');
  assert.equal(section.data.originalDate, undefined, 'nor c. 385 BC');
  assert.ok(section.data.relations['dc:relation'].endsWith(links.items[loeb36.id].key), 'a section is related to its anthology');
  const keys = Object.values(links.items).map(link => link.citationKey);
  assert.equal(new Set(keys).size, keys.length, 'every key is different');
  assert.ok(keys.includes('Augustine1991a'), 'the cited Logos Confessions of the same year gets a suffix');
});

test('a second run sends nothing; a changed shelf renames the link quickly, and the book itself is not touched', async () => {
  const { fake, zotero, links } = setup({ delayMs: 20 });
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const before = fake.calls.length;
  assert.match((await sendToZotero(records, links, zotero))[0], /0 new, 0 updated, 6 unchanged/);
  assert.deepEqual(fake.calls.slice(before), ['GET /collections?limit=100', 'GET /items?format=versions&includeTrashed=0'], 'only two small checks: the collection, and which items still exist');
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
  assert.deepEqual(tags('Phaedo'), ['Loci: removed'], 'its sections too');
  assert.deepEqual(tags('Confessions (Logos, cited)'), ['Loci: removed']);
  assert.equal(mainItems(fake).length, 6);
  assert.ok(!fake.calls.some(call => call.startsWith('DELETE')));
});

test('on the first run a book already in Zotero is linked, keeps its pinned key, notes and tags, and the differences are reported', async () => {
  const { fake, zotero, links } = setup();
  const key = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '978-0-19-953782-2', publisher: 'OUP', date: '1991',
    extra: 'Citation Key: Augustine1991\nRead for the seminar', tags: [{ tag: 'patristics' }], collections: ['OLDCOLL1'] });
  const report = await sendToZotero(sampleRecords(), links, zotero);
  assert.match(report[0], /Zotero: 5 new, 1 updated/);
  assert.equal(links.items[chadwick.id].key, key, 'linked, not made again');
  const item = fake.items.get(key).data;
  assert.equal(item.publisher, 'Oxford University Press', "Loci's data is written");
  assert.equal(item.citationKey, 'Augustine1991', 'the key pinned in Extra moves to the Citation Key field');
  assert.equal(item.extra, 'Read for the seminar', 'the note in Extra stays');
  assert.deepEqual(item.tags, [{ tag: 'patristics' }]);
  assert.deepEqual(item.collections.length, 2, 'its other collection stays');
  assert.ok(report.some(line => line.includes('publisher was "OUP"')), 'the overwritten difference is reported');
});

test('items deleted in Zotero, and a deleted collection, are made again on the next run, with the same keys', async () => {
  const { fake, zotero, links } = setup();
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const keyBefore = links.items[chadwick.id].citationKey;
  for (const key of [...fake.items.keys()]) fake.remove(key);
  fake.removeCollections();
  const report = await sendToZotero(records, links, zotero);
  assert.match(report.join(' '), /6 items were missing in Zotero/);
  assert.match(report[0], /Zotero: 6 new/);
  assert.equal(mainItems(fake).length, 6);
  assert.equal(attachments(fake).length, 3, 'the links under the books are made again too');
  assert.equal(links.items[chadwick.id].citationKey, keyBefore, 'the pinned key stays the same');
  assert.equal(fake.byTitle('Confessions')[0].data.collections[0], links.collection, 'in the new collection');
  assert.match((await sendToZotero(records, links, zotero))[0], /0 new, 0 updated, 6 unchanged/);
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

test('a Bible is sent as one book, never as a section per biblical book; other anthologies keep their sections', async () => {
  const { fake, zotero, links } = setup();
  await sendToZotero([...na28Works, na28, copy('c0py0000000r', na28.id), ...triglottaWorks, triglotta, copy('c0py0000000s', triglotta.id)], links, zotero);
  assert.equal(fake.byTitle('Novum Testamentum Graece').length, 1);
  assert.equal(mainItems(fake).filter(item => item.data.bookTitle === 'Novum Testamentum Graece').length, 0, 'no "Romans, in NA28"');
  assert.equal(mainItems(fake).filter(item => item.data.bookTitle && item.data.bookTitle.startsWith('Concordia Triglotta')).length, triglottaWorks.length, 'the Book of Concord keeps a section per document');
  const { entries } = buildLibrary([...loebWorks, loeb36, plato]);
  assert.equal(isBible(entries[0]), false, 'Plato is not a Bible');
});

test('a section of a volume of a set has the set as its book, the volume number, and the volume title in Extra', async () => {
  const { fake, zotero, links } = setup();
  const volume = { ...loeb36, set: 'Loeb Classical Library', volume: '36', title: 'Loeb Classical Library', subtitle: 'Volume 36: Euthyphro. Apology. Crito. Phaedo. Phaedrus.' };
  await sendToZotero([...loebWorks, volume, plato, copy('c0py0000000t', loeb36.id)], links, zotero);
  const [section] = fake.byTitle('Phaedo');
  assert.equal(section.data.bookTitle, 'Loeb Classical Library');
  assert.equal(section.data.volume, '36');
  assert.equal(section.data.extra, 'volume-title: Euthyphro. Apology. Crito. Phaedo. Phaedrus.');
});

test('the companion has matching .cmd and .sh launchers', () => {
  const cmd = readFileSync(join(here, '..', 'loci-zotero.cmd'), 'utf8');
  const sh = readFileSync(join(here, '..', 'loci-zotero.sh'), 'utf8');
  assert.ok(cmd.includes('cd /d "%~dp0"') && cmd.includes('node loci-zotero.mjs %*'));
  assert.ok(sh.startsWith('#!/bin/sh') && sh.includes('node loci-zotero.mjs "$@"'));
});

test("Loci's Library of Congress call number goes to Zotero's Call Number; without one, Zotero's own stays", async () => {
  const { fake, zotero, links } = setup();
  const key = fake.add({ itemType: 'book', title: 'Confessions', ISBN: '9780199537822', date: '1991', callNumber: 'BR65 .A6 1991', collections: [] });
  await sendToZotero(sampleRecords(), links, zotero);
  assert.equal(fake.items.get(key).data.callNumber, 'BR65 .A6 1991', 'not emptied when Loci has none');
  const numbered = withField(chadwick, 'identifiers', { lccn: '2008491261', oclc: null, lcc: 'BR65.A6 E5 2008', ddc: null }, '2026-11-12T09:00:00Z');
  await sendToZotero(sampleRecords().map(record => (record.id === chadwick.id ? numbered : record)), links, zotero);
  assert.equal(fake.items.get(key).data.callNumber, 'BR65.A6 E5 2008');
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
