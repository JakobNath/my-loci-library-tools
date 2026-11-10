// loci-sizes, against answers recorded from the Library of Congress catalog
// (tests/answers/). Run with `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { heightFromAnswer } from '../sizes.mjs';
import { runSizes } from '../loci-sizes.mjs';
import { newRecord } from '../../core/records.js';
import { writeRecord, readRecords } from '../../shared/data-repo.mjs';

const answers = join(dirname(fileURLToPath(import.meta.url)), 'answers');
const answer = name => readFileSync(join(answers, name), 'utf8');
const NOW = '2026-11-10T12:00:00Z';

// A small data repository in a temporary folder.
function dataRepo(editions) {
  const folder = mkdtempSync(join(tmpdir(), 'loci-sizes-'));
  mkdirSync(join(folder, 'editions'));
  for (const edition of editions) writeRecord(folder, edition);
  return folder;
}

// Answers as the catalog gave them: Chadwick's Confessions is in it (20 cm); other ISBNs are not.
const fetchFn = async url => ({ ok: true, status: 200, text: async () => (url.includes('9780199537822') ? answer('9780199537822.xml') : answer('none.xml')) });

test('the height is read from the record that lists the ISBN, in millimeters', () => {
  assert.equal(heightFromAnswer(answer('9780199537822.xml'), '9780199537822'), 200);
  assert.equal(heightFromAnswer(answer('9780199537822.xml'), '9780140449198'), null, 'a record for another book is not used');
  assert.equal(heightFromAnswer(answer('none.xml'), '9780199537822'), null);
});

test('heights are filled once, a typed height is never touched, and a second run changes nothing', async () => {
  const chadwick = newRecord('edition', 'chadw1ck1991', NOW, { title: 'Confessions', isbn: '9780199537822' });
  const measured = newRecord('edition', 'measured0001', NOW, { title: 'Measured', isbn: '9780199537822', height: 215, heightSource: 'measured' });
  const unknown = newRecord('edition', 'unkn0wn00001', NOW, { title: 'Not in the catalog', isbn: '9780000000002' });
  const folder = dataRepo([chadwick, measured, unknown]);
  const checkedFile = join(folder, 'checked.json');
  try {
    const first = await runSizes(folder, { useGit: false, fetchFn, now: NOW, checkedFile });
    assert.match(first[0], /1 filled, 1 not in the catalog/);
    const after = new Map(readRecords(folder).map(record => [record.id, record]));
    assert.equal(after.get(chadwick.id).height, 200);
    assert.equal(after.get(chadwick.id).heightSource, 'catalog');
    assert.equal(after.get(measured.id).height, 215, 'the measured height stays');
    assert.equal(after.get(unknown.id).height, null);
    const second = await runSizes(folder, { useGit: false, fetchFn, now: NOW, checkedFile });
    assert.match(second[0], /0 filled, 0 not in the catalog/, 'nothing is asked again so soon');
    assert.deepEqual(readRecords(folder), [...after.values()], 'no file changed');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
