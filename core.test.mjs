// Tests for the shared core: runs its own tests (core/tests/*.tests.js), and
// checks that this copy matches the app repository's core, so the two never
// drift apart. Run with `node --test` from this folder. If a check fails
// after editing core, edit it in the app repository and run update-core.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const copy = join(here, 'core');
const original = join(here, '..', 'my-loci-library', 'core');

for (const file of readdirSync(join(copy, 'tests')).filter(name => name.endsWith('.tests.js')).sort()) {
  const { tests } = await import(pathToFileURL(join(copy, 'tests', file)).href);
  for (const check of tests) test(`core/${file} > ${check.name}`, check.fn);
}

function filesIn(folder) {
  const found = [];
  (function walk(current) {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(folder, path).split(sep).join('/'));
    }
  })(folder);
  return found.sort();
}

/** Differences between two core folders, in plain words. */
export function coreDifferences(first, second) {
  const a = filesIn(first);
  const b = filesIn(second);
  const differences = [];
  for (const file of a) if (!b.includes(file)) differences.push(`${file} is only in ${first}`);
  for (const file of b) if (!a.includes(file)) differences.push(`${file} is only in ${second}`);
  for (const file of a.filter(name => b.includes(name))) {
    if (readFileSync(join(first, file), 'utf8') !== readFileSync(join(second, file), 'utf8')) differences.push(`${file} differs`);
  }
  return differences;
}

test('this copy of core matches the app repository\'s core', { skip: !existsSync(original) && 'the app repository is not next to this one' }, () => {
  assert.deepEqual(coreDifferences(copy, original), [], 'Run update-core (.cmd or .sh) to copy core from the app repository.');
});

test('the copy check notices a file edited in one place only', () => {
  assert.ok(coreDifferences(copy, join(copy, 'tests')).length > 0);
});

test('this copy of the known sets\' lists matches the app repository\'s sets/', { skip: !existsSync(join(here, '..', 'my-loci-library', 'sets')) && 'the app repository has no sets/ here' }, () => {
  assert.deepEqual(coreDifferences(join(here, 'sets'), join(here, '..', 'my-loci-library', 'sets')), [], 'Run update-core (.cmd or .sh) to copy sets/ from the app repository.');
});
