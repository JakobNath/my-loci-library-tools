// loci-enrich, against the answers recorded from the three sources on
// 10 November 2026 (core/tests/answers/, copied from the app). Run with
// `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runEnrich, MEMORY } from '../loci-enrich.mjs';
import { fillBook } from '../enrich.mjs';
import { mergeFound } from '../../core/book-data.js';
import { fromLibraryOfCongress } from '../../core/marc.js';
import { newRecord } from '../../core/records.js';
import { writeRecord, readRecords } from '../../shared/data-repo.mjs';
import * as plato from '../../core/tests/answers/9780872203495.js';
import * as holmes from '../../core/tests/answers/9780801031083.js';
import * as anna from '../../core/tests/answers/9781857150582.js';

const NOW = '2026-11-10T12:00:00Z';
const LATER = '2027-03-01T12:00:00Z'; // more than 90 days on

// A fetch that answers as the three sources did; an ISBN not recorded is unknown to all three.
function recordedServices(books) {
  const asked = [];
  const fetchFn = async url => {
    asked.push(url);
    const book = books.find(item => url.includes(item.isbn) || (item.googleBooksVolume && url.includes(JSON.parse(item.googleBooksVolume).id)));
    const text = url.includes('loc.gov') ? (book ? book.libraryOfCongress : anna.libraryOfCongress) // "0 records"
      : !book ? null
        : url.includes('openlibrary.org/isbn/') ? book.openLibraryEdition
          : url.includes('volumes?q=') ? book.googleBooksSearch
            : url.includes('/volumes/') ? book.googleBooksVolume : null;
    return { ok: text !== null, status: text === null ? 404 : 200, text: async () => text };
  };
  return { fetchFn, asked };
}

function dataRepo(records) {
  const folder = mkdtempSync(join(tmpdir(), 'loci-enrich-'));
  for (const name of ['editions', 'works']) mkdirSync(join(folder, name));
  for (const record of records) writeRecord(folder, record);
  return folder;
}

const work = (id, title, extra = {}) => newRecord('work', id, NOW, { title, ...extra });
const edition = (id, title, workId, extra = {}) => newRecord('edition', id, NOW, { title, contents: [{ work: workId, extent: 'complete', translator: null, pages: null }], medium: 'physical', ...extra });

test('empty fields are filled from all three sources, and a field a person typed is left alone', async () => {
  const platoWork = work('p1at0w0rk001', 'Complete Works');
  // As the app's version 1 wrote it: no catalogue numbers or subjects yet.
  const { identifiers, subjects, ...version1 } = edition('p1at0ed00001', 'Complete Works', platoWork.id, { isbn: plato.isbn, place: 'Indianapolis' });
  const complete = { ...version1, format: 1 };
  const folder = dataRepo([platoWork, complete]);
  try {
    const { fetchFn } = recordedServices([plato]);
    const report = await runEnrich(folder, { useGit: false, fetchFn, googleBooksKey: 'test-key', now: NOW, reportFile: null });
    assert.match(report[0], /asked about 1 of 1 books due; 1 filled/);
    const after = new Map(readRecords(folder).map(record => [record.id, record]));
    const book = after.get(complete.id);
    assert.deepEqual([book.pages, book.height, book.heightSource], ['xxx, 1808', 240, 'catalog']);
    assert.deepEqual(book.contributors, [{ name: 'John M. Cooper', role: 'editor' }], 'translators and editors only');
    assert.equal(book.place, 'Indianapolis', 'typed by a person');
    assert.equal(book.thickness, null, "Google Books' impossible thickness is not used");
    assert.deepEqual(book.identifiers, { lccn: '96053280', oclc: null, lcc: 'B358 .C3 1997', ddc: '184' });
    assert.deepEqual(book.subjects, ['Socrates', 'Philosophy, Ancient']);
    assert.equal(book.format, 2);
    assert.equal(after.get(platoWork.id).originalLanguage, 'Ancient Greek');
    assert.deepEqual(after.get(platoWork.id).datings, [], 'an original date is never filled');
    const memory = JSON.parse(readFileSync(join(folder, MEMORY), 'utf8'));
    assert.equal(memory.books[complete.id].wrote.pages, 'xxx, 1808');
    assert.ok(!JSON.stringify(memory).includes('test-key'), 'the key is never written to the data repository');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a second run changes nothing; after 90 days a field a person cleared stays cleared', async () => {
  const platoWork = work('p1at0w0rk001', 'Complete Works');
  const complete = edition('p1at0ed00001', 'Complete Works', platoWork.id, { isbn: plato.isbn });
  const folder = dataRepo([platoWork, complete]);
  try {
    const { fetchFn, asked } = recordedServices([plato]);
    await runEnrich(folder, { useGit: false, fetchFn, now: NOW, reportFile: null });
    const first = readRecords(folder);
    const count = asked.length;
    const again = await runEnrich(folder, { useGit: false, fetchFn, now: NOW, reportFile: null });
    assert.match(again[0], /asked about 0 of 0 books due/);
    assert.equal(asked.length, count, 'nothing is asked again so soon');
    assert.deepEqual(readRecords(folder), first, 'no file changed');
    // A person clears the pages and changes the height; months later the book is asked again.
    const book = first.find(record => record.id === complete.id);
    writeRecord(folder, { ...book, pages: null, height: 235, heightSource: 'measured' });
    const later = await runEnrich(folder, { useGit: false, fetchFn, now: LATER, reportFile: null });
    assert.match(later[0], /asked about 1 of 1 books due; 0 filled/);
    const now = readRecords(folder).find(record => record.id === complete.id);
    assert.deepEqual([now.pages, now.height, now.heightSource], [null, 235, 'measured']);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a book no source knows is asked again only after 90 days, and --limit asks the rest next time', async () => {
  const one = work('w0rk00000001', 'Unknown');
  const unknown = edition('unkn0wn00001', 'Not in any catalog', one.id, { isbn: '9780000000002' });
  const two = work('w0rk00000002', 'Anna Karenina');
  const karenina = edition('anna00000001', 'Anna Karenina', two.id, { isbn: anna.isbn });
  const folder = dataRepo([one, unknown, two, karenina]);
  try {
    const { fetchFn } = recordedServices([anna]);
    const first = await runEnrich(folder, { useGit: false, fetchFn, now: NOW, limit: 1, reportFile: null });
    assert.match(first.join('\n'), /1 books are left for the next run/);
    const second = await runEnrich(folder, { useGit: false, fetchFn, now: NOW, reportFile: null });
    assert.match(second[0], /asked about 1 of 1 books due/, 'it carries on where it stopped');
    assert.match([...first, ...second].join('\n'), /1 not known to any source/);
    assert.match((await runEnrich(folder, { useGit: false, fetchFn, now: NOW, reportFile: null }))[0], /0 of 0 books due/);
    assert.match((await runEnrich(folder, { useGit: false, fetchFn, now: LATER, reportFile: null }))[0], /2 of 2 books due/);
    assert.equal(readRecords(folder).find(record => record.id === karenina.id).thickness, 46, 'Open Library alone, without a key');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('anthology contents are only suggested in the report, and never for a Bible', async () => {
  const found = mergeFound([fromLibraryOfCongress(holmes.libraryOfCongress, holmes.isbn)]);
  const fathers = work('ap0st0l1cfa1', 'The Apostolic Fathers in English');
  const book = edition('h0lmes000001', 'The Apostolic Fathers in English', fathers.id, { isbn: holmes.isbn });
  const result = fillBook({ edition: book, works: [fathers] }, found, {}, NOW);
  assert.equal(result.contents.length, 21);
  assert.equal(result.changed.find(record => record.type === 'edition').contents.length, 1, 'the contents themselves are not changed');
  const bible = work('b1b1e0000001', 'The Holy Bible', { category: 'Bibles' });
  assert.deepEqual(fillBook({ edition: { ...book, contents: [{ work: bible.id }] }, works: [bible] }, found, {}, NOW).contents, []);
  const inSet = fillBook({ edition: { ...book, set: "Chemnitz's Works", volume: '5' }, works: [fathers] }, { ...found, series: "Chemnitz's Works", seriesNumber: '7, 8' }, {}, NOW);
  assert.equal(inSet.changed[0].series, null, 'a series that repeats the set is not filled');
  const listedBooks = { ...found, contents: [{ title: 'Genesis', author: '' }, { title: 'Exodus', author: '' }] };
  assert.deepEqual(fillBook({ edition: book, works: [fathers] }, listedBooks, {}, NOW).contents, [], 'contents that are books of the Bible');
  const folder = dataRepo([fathers, book]);
  try {
    const report = await runEnrich(folder, { useGit: false, fetchFn: recordedServices([holmes]).fetchFn, now: NOW, reportFile: join(folder, 'report.txt') });
    assert.match(report.join('\n'), /21 works:\n {6}First Clement/);
    assert.ok(existsSync(join(folder, 'report.txt')), 'the report is kept');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
