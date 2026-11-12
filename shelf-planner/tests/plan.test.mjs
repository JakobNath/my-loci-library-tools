// The shelf planner (shelf-planner/plan.mjs), with a few made-up books.
// Run with `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRecord } from '../../core/records.js';
import { validateRecord } from '../../core/validate.js';
import { readShelves, shelvesText, planShelves, recordsForPlan, planText, FILL } from '../plan.mjs';

const NOW = '2026-11-12T12:00:00Z';
const LATER = '2026-11-13T09:00:00Z';
const office = ['Home', 'Office', 'Case 1'];

// A book: its author, work, edition (with a measured thickness in mm) and one copy on a shelf.
function book(n, authorName, title, year, thickness, shelf, category = null) {
  const author = newRecord('author', `auth0r0000${String(n).padStart(2, '0')}`, NOW, { name: authorName });
  const work = newRecord('work', `w0rk00000${String(n).padStart(3, '0')}`, NOW, {
    title, authors: [author.id], category,
    datings: [{ text: String(year), earliest: year, latest: year, certainty: 'exact', kind: null, note: '', working: true }],
  });
  const edition = newRecord('edition', `ed1t10n00${String(n).padStart(3, '0')}`, NOW, {
    title, contents: [{ work: work.id, piece: null, extent: 'complete', translator: null, pages: null, cite: false }], medium: 'physical', thickness, thicknessSource: 'measured',
  });
  const copy = newRecord('copy', `c0py00000${String(n).padStart(3, '0')}`, NOW, { edition: edition.id, status: 'owned', location: [...office, shelf], added: '2026-11-12' });
  return [author, work, edition, copy];
}

const records = [
  ...book(1, 'Luther', 'Small Catechism', 1529, 300, 'Shelf 1', 'Theology'),
  ...book(2, 'Augustine', 'Confessions', 397, 300, 'Shelf 2', 'Theology'),
  ...book(3, 'Plato', 'Phaedo', -360, 200, 'Shelf 2', 'Philosophy'),
  ...book(4, 'Homer', 'Iliad', -750, 400, 'Shelf 1', 'Poetry'),
];
const shelves = readShelves('Home › Office › Case 1 › Shelf 1 = 80\nHome › Office › Case 1 › Shelf 2 = 60\n# a note\n').shelves;

test('shelves are read from plain lines, in centimeters, and written back the same', () => {
  assert.deepEqual(shelves, [{ location: [...office, 'Shelf 1'], width: 800 }, { location: [...office, 'Shelf 2'], width: 600 }]);
  assert.equal(shelvesText(shelves), 'Home › Office › Case 1 › Shelf 1 = 80\nHome › Office › Case 1 › Shelf 2 = 60');
  assert.equal(readShelves('Shelf without a width').problems.length, 1);
  assert.equal(readShelves('A › B = 72,5').shelves[0].width, 725, 'a comma works as a decimal point');
});

test('books are put in the chosen order and fitted shelf by shelf, filling each to 90 percent', () => {
  const plan = planShelves(records, { place: office, shelves, order: 'author' });
  // Augustine 300 + Homer 400 = 700 mm fits 720 mm (90 percent of 800); Luther and Plato go to shelf 2 (500 of 540).
  assert.deepEqual(plan.shelves.map(shelf => shelf.books.map(item => item.title)), [['Confessions', 'Iliad'], ['Small Catechism', 'Phaedo']]);
  assert.equal(FILL, 0.9);
  assert.equal(plan.left.length, 0);
  assert.equal(plan.moves, 2, 'Confessions up, Catechism down; Iliad and Phaedo stay');
  const byDate = planShelves(records, { place: office, shelves, order: 'originalDate' });
  // Iliad and Phaedo fill shelf 1 to 600 mm, so Confessions (300) starts shelf 2 and the Catechism (300) no longer fits its 540.
  assert.deepEqual(byDate.shelves.map(shelf => shelf.books.map(item => item.title)), [['Iliad', 'Phaedo'], ['Confessions']]);
  assert.deepEqual(byDate.left.map(item => item.title), ['Small Catechism']);
});

test('books that do not fit are listed, and books elsewhere are left alone', () => {
  const plan = planShelves([...records, ...book(5, 'Gibbon', 'Decline and Fall', 1776, 600, 'Shelf 1'), ...book(6, 'Aquinas', 'Summa', 1265, 100, 'Shelf 9').map(record => (record.type === 'copy' ? { ...record, location: ['Home', 'Hall'] } : record))],
    { place: office, shelves, order: 'author' });
  assert.ok(plan.left.some(item => item.title === 'Decline and Fall'));
  assert.ok(!plan.shelves.some(shelf => shelf.books.some(item => item.title === 'Summa')), 'a book in the hall is not in this plan');
  assert.match(planText(plan), /Do not fit \(\d+, \d+ cm\)/);
});

test('recording the plan writes only the copies, with their new shelf and order, and nothing else', () => {
  const plan = planShelves(records, { place: office, shelves, order: 'author' });
  const changed = recordsForPlan(records, plan, LATER);
  assert.ok(changed.every(record => record.type === 'copy'));
  assert.equal(changed.length, 4, 'every copy gets a shelf order; two also a new shelf');
  const confessions = changed.find(record => record.id === 'c0py00000002');
  assert.deepEqual(confessions.location, [...office, 'Shelf 1']);
  const shelf1 = changed.filter(record => record.location[3] === 'Shelf 1').sort((a, b) => (a.shelfOrder < b.shelfOrder ? -1 : 1));
  assert.deepEqual(shelf1.map(record => record.id), ['c0py00000002', 'c0py00000004'], 'Augustine before Homer along the shelf');
  for (const record of changed) assert.deepEqual(validateRecord(record), [], record.id);
  assert.match(planText(plan), /← from Home › Office › Case 1 › Shelf 2/);
});

test('on a catalog folder: list the shelves, suggest without writing, and record only a plan where everything fits', async () => {
  const { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { writeRecord, readRecords } = await import('../../shared/data-repo.mjs');
  const { shelvesFor, suggest, record } = await import('../planner.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'loci-planner-'));
  try {
    for (const name of ['works', 'editions', 'copies', 'authors']) mkdirSync(join(folder, name));
    for (const item of records) writeRecord(folder, item);
    const listed = shelvesFor(folder, 'Home › Office');
    assert.equal(listed, 'Home › Office › Case 1 › Shelf 1 = \nHome › Office › Case 1 › Shelf 2 = ', 'the shelves its books stand on, widths to fill in');
    const before = readdirSync(join(folder, 'copies')).map(name => readFileSync(join(folder, 'copies', name), 'utf8')).join();
    const tight = 'Home › Office › Case 1 › Shelf 1 = 80\nHome › Office › Case 1 › Shelf 2 = 50';
    assert.match(suggest(folder, { place: 'Home › Office', shelves: tight, order: 'author' }).output, /Do not fit/);
    assert.equal(record(folder, { place: 'Home › Office', shelves: tight, order: 'author' }, { now: LATER, useGit: false }).ok, false, 'not recorded while a book is left over');
    assert.equal(readdirSync(join(folder, 'copies')).map(name => readFileSync(join(folder, 'copies', name), 'utf8')).join(), before, 'nothing written while planning');
    const roomy = 'Home › Office › Case 1 › Shelf 1 = 80\nHome › Office › Case 1 › Shelf 2 = 60';
    const done = record(folder, { place: 'Home › Office', shelves: roomy, order: 'author' }, { now: LATER, useGit: false });
    assert.ok(done.ok, done.output);
    const confessions = readRecords(folder).find(item => item.id === 'c0py00000002');
    assert.deepEqual(confessions.location, [...office, 'Shelf 1']);
    assert.equal(readFileSync(join(folder, 'integrations', 'shelves.txt'), 'utf8'), `${roomy}\n`, 'the widths are kept for next time');
    assert.equal(shelvesFor(folder, 'Home › Office'), roomy, 'and offered again');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('shelf lists: each shelf of a place, in shelf order or by original date, as a page for paper', async () => {
  const { shelfLists, shelfListsHtml } = await import('../lists.mjs');
  const placed = records.map(record => (record.id === 'c0py00000004' ? { ...record, shelfOrder: 'a' } : record.id === 'c0py00000001' ? { ...record, shelfOrder: 'b' } : record));
  const along = shelfLists(placed, office, 'shelf');
  assert.deepEqual(along.map(list => list.shelf), ['Home › Office › Case 1 › Shelf 1', 'Home › Office › Case 1 › Shelf 2']);
  assert.deepEqual(along[0].books.map(item => item.title), ['Iliad', 'Small Catechism'], 'in shelf order');
  const byDate = shelfLists(placed, office, 'date');
  assert.deepEqual(byDate[1].books.map(item => item.title), ['Phaedo', 'Confessions'], 'oldest first');
  const html = shelfListsHtml(along, { place: office, order: 'shelf', today: '2026-11-12' });
  assert.ok(html.includes('<h2>Home › Office › Case 1 › Shelf 1 <span>2 books</span></h2>'));
  assert.ok(shelfListsHtml([{ shelf: 'A', books: [{ author: '<b>', title: 'x', date: '', year: null }] }], { place: ['A'], order: 'shelf', today: '' }).includes('&lt;b&gt;'), 'escaped');
});
