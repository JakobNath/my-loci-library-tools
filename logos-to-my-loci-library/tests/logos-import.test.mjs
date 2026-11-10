// logos-to-my-loci-library, with a small made-up export (tests/logos-sample.csv)
// and the sample books, in temporary folders. Run with `node --test` in the tools folder.
// When Jakob's real export arrives (inputs/logos-sample.csv), its column names
// go into columns.mjs and a few of its rows can replace the made-up ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseCsv, readRow, personName } from '../columns.mjs';
import { importFile, confirmLinks, fetchCovers } from '../logos-import.mjs';
import { writeRecord, readRecords, FOLDERS } from '../../shared/data-repo.mjs';
import { withField } from '../../core/records.js';
import { augustine, confessions, chadwick } from '../../core/tests/samples.js';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(here, 'logos-sample.csv');
const NOW = '2026-11-10T12:00:00Z';

// A data repository holding one physical book (Chadwick's Confessions), so links can be suggested.
function repo() {
  const folder = mkdtempSync(join(tmpdir(), 'logos-import-'));
  for (const name of Object.values(FOLDERS)) mkdirSync(join(folder, name));
  for (const record of [augustine, confessions, chadwick]) writeRecord(folder, record);
  return folder;
}
const logosEditions = folder => readRecords(folder).filter(record => record.type === 'edition' && record.medium === 'logos');
const copyOf = (folder, edition) => readRecords(folder).find(record => record.type === 'copy' && record.edition === edition.id);

test('the export is read: quoted commas, names written surname first, and columns kept as extra Logos data', () => {
  const rows = parseCsv(readFileSync(SAMPLE, 'utf8'));
  assert.equal(rows.length, 4);
  const anf = readRow(rows[1]);
  assert.equal(anf.title, 'The Ante-Nicene Fathers, Volume 1');
  assert.deepEqual(anf.authors.map(person => person.name), ['Alexander Roberts', 'James Donaldson']);
  assert.equal(anf.year, 1885);
  assert.deepEqual(anf.extra, { 'Resource Type': 'Monograph' });
  assert.deepEqual(personName('Pieper, Francis'), { name: 'Francis Pieper', sortName: 'Pieper, Francis' });
  assert.deepEqual(parseCsv('Title\tResource ID\n"A ""quoted"" title"\tLLS:X\n').map(readRow).map(row => row.title), ['A "quoted" title'], 'tab-separated, with quotes');
});

test('a first import adds each resource once, finds existing authors, suggests links, and a second run changes nothing', () => {
  const folder = repo();
  const linksFile = join(folder, 'links.txt');
  try {
    const report = importFile(folder, SAMPLE, { now: NOW, linksFile });
    assert.match(report[0], /4 rows read: 4 new books, 0 updated, 0 unchanged/);
    const editions = logosEditions(folder);
    assert.equal(editions.length, 4);
    const confessionsLogos = editions.find(edition => edition.logosId === 'LLS:CONFESSCHADWICK');
    const work = readRecords(folder).find(record => record.id === confessionsLogos.contents[0].work);
    assert.deepEqual(work.authors, [augustine.id], 'Augustine is found, not made again');
    assert.deepEqual(work.datings, [], 'no original date is filled in');
    assert.equal(copyOf(folder, confessionsLogos).status, 'owned');
    assert.ok(readFileSync(linksFile, 'utf8').includes(`no | ${confessionsLogos.id} | ${confessions.id} |`), 'the link is suggested, not made');
    const files = readRecords(folder);
    const again = importFile(folder, SAMPLE, { now: '2026-11-11T12:00:00Z', linksFile });
    assert.match(again[0], /0 new books, 0 updated, 4 unchanged/);
    assert.deepEqual(readRecords(folder), files, 'no file changed');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a field edited in Loci is never overwritten; untouched fields follow Logos', () => {
  const folder = repo();
  try {
    importFile(folder, SAMPLE, { now: NOW, linksFile: join(folder, 'links.txt') });
    const pieper = logosEditions(folder).find(edition => edition.logosId === 'LLS:PIEPER1');
    writeRecord(folder, withField(pieper, 'title', 'Christian Dogmatics, vol. 1', '2026-11-10T13:00:00Z'));
    const newer = join(folder, 'newer.csv');
    writeFileSync(newer, readFileSync(SAMPLE, 'utf8').replace('"Christian Dogmatics","Pieper, Francis",Concordia Publishing House', '"Christian Dogmatics (Logos)","Pieper, Francis",CPH'));
    const report = importFile(folder, newer, { now: '2026-11-12T12:00:00Z', linksFile: join(folder, 'links.txt') });
    assert.match(report[0], /1 updated/);
    const after = logosEditions(folder).find(edition => edition.logosId === 'LLS:PIEPER1');
    assert.equal(after.title, 'Christian Dogmatics, vol. 1', 'our title stays');
    assert.equal(after.publisher, 'CPH', 'the publisher follows Logos');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a full export marks missing resources gone from Logos; a filtered one never does', () => {
  const folder = repo();
  const linksFile = join(folder, 'links.txt');
  try {
    importFile(folder, SAMPLE, { now: NOW, linksFile });
    const fewer = join(folder, 'fewer.csv');
    writeFileSync(fewer, readFileSync(SAMPLE, 'utf8').split('\n').filter(line => !line.includes('LLS:BHS')).join('\n'));
    const bhs = () => logosEditions(folder).find(edition => edition.logosId === 'LLS:BHS');
    importFile(folder, fewer, { now: NOW, linksFile });
    assert.equal(copyOf(folder, bhs()).status, 'owned', 'filtered: nothing removed');
    importFile(folder, fewer, { now: NOW, linksFile, full: true });
    assert.equal(copyOf(folder, bhs()).status, 'gone from Logos');
    importFile(folder, SAMPLE, { now: NOW, linksFile, full: true });
    assert.equal(copyOf(folder, bhs()).status, 'owned', 'back again when it returns');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a confirmed link joins the Logos edition to the existing work, and the spare work goes to the trash', () => {
  const folder = repo();
  const linksFile = join(folder, 'links.txt');
  try {
    importFile(folder, SAMPLE, { now: NOW, linksFile });
    writeFileSync(linksFile, readFileSync(linksFile, 'utf8').replace(/^no \|/m, 'yes |'));
    assert.match(confirmLinks(folder, { now: NOW, linksFile })[0], /1 links confirmed/);
    const edition = logosEditions(folder).find(item => item.logosId === 'LLS:CONFESSCHADWICK');
    assert.equal(edition.contents[0].work, confessions.id);
    assert.equal(readRecords(folder).filter(record => record.type === 'work' && record.title === 'Confessions' && !record.trashed).length, 1);
    assert.ok(!readFileSync(linksFile, 'utf8').includes('|'), 'confirmed lines leave the file');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('covers are fetched into the inbox in batches, and a second run fetches nothing more', async () => {
  const folder = repo();
  try {
    importFile(folder, SAMPLE, { now: NOW, linksFile: join(folder, 'links.txt') });
    const fetchFn = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer });
    assert.match((await fetchCovers(folder, { limit: 1, fetchFn }))[0], /1 saved/);
    assert.match((await fetchCovers(folder, { limit: 10, fetchFn }))[0], /1 saved/, 'the other book with an ISBN');
    assert.match((await fetchCovers(folder, { limit: 10, fetchFn }))[0], /0 saved/, 'books without an ISBN keep their drawn cover');
    const pieper = logosEditions(folder).find(edition => edition.logosId === 'LLS:PIEPER1');
    assert.ok(existsSync(join(folder, 'images', 'inbox', `${pieper.id}.jpg`)));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the importer has matching .cmd and .sh launchers', () => {
  const cmd = readFileSync(join(here, '..', 'logos-import.cmd'), 'utf8');
  const sh = readFileSync(join(here, '..', 'logos-import.sh'), 'utf8');
  assert.ok(cmd.includes('cd /d "%~dp0"') && cmd.includes('node logos-import.mjs %*'));
  assert.ok(sh.startsWith('#!/bin/sh') && sh.includes('node logos-import.mjs "$@"'));
});
