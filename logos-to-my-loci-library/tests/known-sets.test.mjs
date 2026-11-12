// A Logos resource that is a volume of a known set takes its works from the
// set's list (core/known-sets.js). The list here is a small one made for the
// test; the real lists are in sets/. Run with `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKnownSet } from '../../core/known-sets.js';
import { validateRecord } from '../../core/validate.js';
import { importRows, knownVolumeOf } from '../import.mjs';
import { readRow } from '../columns.mjs';

const LIST = `set: Luther's Works
publisher: Fortress Press
checked: 2026-11-12 test

volume: 31 | Career of the Reformer I
Martin Luther — Ninety-five Theses | Disputatio pro declaratione virtutis indulgentiarum | Latin — 1517 | trans. C. M. Jacobs
Martin Luther — Heidelberg Disputation | Disputatio Heidelbergae habita | Latin — 1518 | trans. Harold J. Grimm
`;
const sets = [parseKnownSet(LIST)];
const row = (title, series) => ({ 'Resource ID': `LLS:LW${title.length}`, Title: title, Author: 'Luther, Martin', Publishers: 'Fortress Press', Series: series });

test('a Logos resource is found in a known set by its series and the volume in its title', () => {
  const known = knownVolumeOf(readRow(row("Luther's Works, Vol. 31: Career of the Reformer I", "Luther's Works")), sets);
  assert.equal(known.volume.title, 'Career of the Reformer I');
  assert.equal(knownVolumeOf(readRow(row("Luther's Works, Vol. 99: No Such Volume", "Luther's Works")), sets), null, 'a volume the list lacks');
  assert.equal(knownVolumeOf(readRow(row('Romans', 'Pillar New Testament Commentary')), sets), null, 'a book of no known set');
});

test('a new Logos volume of a known set gets the list\'s works, with their checked dates, and its set and volume', () => {
  let counter = 0;
  const result = importRows([row("Luther's Works, Vol. 31: Career of the Reformer I", "Luther's Works")], [], { imported: {} },
    { now: '2026-11-12T12:00:00Z', today: '2026-11-12', newId: () => `kv${String(++counter).padStart(10, '0')}`, sets });
  const edition = result.changed.find(record => record.type === 'edition');
  const works = result.changed.filter(record => record.type === 'work');
  assert.deepEqual([edition.set, edition.volume, edition.medium], ["Luther's Works", '31', 'logos']);
  assert.deepEqual(works.map(work => [work.title, work.originalLanguage, work.datings[0].text]), [['Ninety-five Theses', 'Latin', '1517'], ['Heidelberg Disputation', 'Latin', '1518']]);
  assert.deepEqual(edition.contents.map(entry => entry.translator), ['C. M. Jacobs', 'Harold J. Grimm']);
  assert.equal(result.changed.filter(record => record.type === 'author').length, 1, 'Martin Luther, once');
  assert.deepEqual(result.fromSets, ["Luther's Works, Vol. 31"]);
  assert.deepEqual(result.suggestions, [], 'works from a list are not offered as links');
  for (const record of result.changed) assert.deepEqual(validateRecord(record), [], record.type);
});
