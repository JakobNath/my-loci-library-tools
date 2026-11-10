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
import { fakeZotero } from './fake-zotero.mjs';
import { plato, augustine, confessions, chadwick, loebWorks, loeb36 } from '../../core/tests/samples.js';

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

test('physical books, cited Logos books and anthology sections are sent, with original date, pinned key, shelf and Loci link', async () => {
  const { fake, zotero, links } = setup();
  const report = await sendToZotero(sampleRecords(), links, zotero);
  assert.match(report[0], /Zotero: 6 new/, 'Chadwick, the Loeb and its 3 sections, the cited Logos book');
  assert.equal(fake.byTitle('Not cited').length + fake.byTitle('A wish').length, 0, 'uncited Logos books and wishes never go');
  const [book] = fake.byTitle('Confessions');
  assert.equal(book.data.url, 'https://jakobnath.github.io/my-loci-library/#/book/chadw1ck1991');
  assert.equal(book.data.archiveLocation, 'Home › Office › Case 1');
  assert.match(book.data.extra, /^Original Date: 397\nCitation Key: Augustine1991$/);
  assert.equal(book.data.collections.length, 1);
  const [section] = fake.byTitle('Phaedo');
  assert.equal(section.data.itemType, 'bookSection');
  assert.equal(section.data.bookTitle, 'Euthyphro. Apology. Crito. Phaedo. Phaedrus.');
  assert.match(section.data.extra, /Original Date: -385/);
  assert.ok(section.data.relations['dc:relation'].endsWith(links.items[loeb36.id].key), 'a section is related to its anthology');
  const keys = Object.values(links.items).map(link => link.citationKey);
  assert.equal(new Set(keys).size, keys.length, 'every key is different');
  assert.ok(keys.includes('Augustine1991a'), 'the cited Logos Confessions of the same year gets a suffix');
});

test('a second run sends nothing; a changed shelf is sent quickly, alone', async () => {
  const { fake, zotero, links } = setup({ delayMs: 20 });
  const records = sampleRecords();
  await sendToZotero(records, links, zotero);
  const before = fake.calls.length;
  assert.match((await sendToZotero(records, links, zotero))[0], /0 new, 0 updated, 6 unchanged/);
  assert.equal(fake.calls.length, before, 'not one request to Zotero');
  const moved = records.map(record => (record.id === 'c0py0000000p' ? withField(record, 'location', ['Home', 'Study'], NOW) : record));
  const started = Date.now();
  assert.match((await sendToZotero(moved, links, zotero))[0], /0 new, 1 updated/);
  assert.ok(Date.now() - started < 10000, 'under 10 seconds (PLAN.md, speed target)');
  assert.equal(fake.byTitle('Confessions')[0].data.archiveLocation, 'Home › Study');
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
  assert.equal(fake.items.size, 6);
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
  assert.match(item.extra, /Citation Key: Augustine1991\nRead for the seminar/, 'the pinned key and the note in Extra stay');
  assert.deepEqual(item.tags, [{ tag: 'patristics' }]);
  assert.deepEqual(item.collections.length, 2, 'its other collection stays');
  assert.ok(report.some(line => line.includes('publisher was "OUP"')), 'the overwritten difference is reported');
});

test('the companion has matching .cmd and .sh launchers', () => {
  const cmd = readFileSync(join(here, '..', 'loci-zotero.cmd'), 'utf8');
  const sh = readFileSync(join(here, '..', 'loci-zotero.sh'), 'utf8');
  assert.ok(cmd.includes('cd /d "%~dp0"') && cmd.includes('node loci-zotero.mjs %*'));
  assert.ok(sh.startsWith('#!/bin/sh') && sh.includes('node loci-zotero.mjs "$@"'));
});
