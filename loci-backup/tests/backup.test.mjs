// loci-backup, in temporary folders, with the sample books (no Git, no network).
// Run with `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { newRecord } from '../../core/records.js';
import { writeRecord, FOLDERS } from '../../shared/data-repo.mjs';
import { rebuildCatalog, mirrorFolder, monthlySnapshot, fullArchive, writeStatus } from '../backup.mjs';
import { dailyBackup } from '../loci-backup.mjs';
import { plato, augustine, confessions, chadwick, loebWorks, loeb36 } from '../../core/tests/samples.js';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = '2026-11-10T03:00:00Z';
const COVER_ID = 'c0verp1ctvre';

// A small data repository: the sample books, a copy, a cover thumbnail and settings.
function sampleRepo() {
  const folder = mkdtempSync(join(tmpdir(), 'loci-backup-'));
  for (const name of Object.values(FOLDERS)) mkdirSync(join(folder, name));
  mkdirSync(join(folder, 'images', 'thumb'), { recursive: true });
  const withCover = { ...chadwick, images: [{ id: COVER_ID, kind: 'cover', source: 'photo', color: '#884422', ratio: 0.66, master: true, waiting: null }] };
  for (const record of [plato, augustine, confessions, withCover, ...loebWorks, loeb36,
    newRecord('copy', 'c0py0000000n', NOW, { edition: chadwick.id, added: '2026-11-10', location: ['Home', 'Office'], notes: 'Seminary copy' })]) writeRecord(folder, record);
  writeFileSync(join(folder, 'images', 'thumb', `${COVER_ID}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(join(folder, 'settings.json'), '{ "format": 1, "dateStyle": "AD" }\n');
  return folder;
}

test('catalog.json is rebuilt from the record files, and left alone when nothing changed', () => {
  const repo = sampleRepo();
  try {
    assert.equal(rebuildCatalog(repo, NOW), true);
    const catalog = JSON.parse(readFileSync(join(repo, 'catalog.json'), 'utf8'));
    assert.equal(catalog.editions.length, 2);
    assert.equal(catalog.copies.length, 1);
    assert.equal(rebuildCatalog(repo, '2026-11-11T03:00:00Z'), false, 'a later run with no changes writes nothing');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the mirror copies only changed files, the snapshot is made once a month, and the status records both', () => {
  const repo = sampleRepo();
  const backup = mkdtempSync(join(tmpdir(), 'loci-backup-drive-'));
  try {
    const first = mirrorFolder(repo, join(backup, 'data'));
    assert.ok(first > 5);
    assert.equal(mirrorFolder(repo, join(backup, 'data')), 0, 'nothing changed, nothing copied');
    assert.equal(monthlySnapshot(repo, backup, NOW), '2026-11');
    const snapshot = join(backup, 'snapshots', '2026-11');
    assert.deepEqual(readdirSync(snapshot).sort(), ['catalog.bib', 'catalog.csl.json', 'catalog.csv', 'catalog.html', 'catalog.json']);
    const html = readFileSync(join(snapshot, 'catalog.html'), 'utf8');
    assert.ok(html.includes('Confessions') && html.includes('Home › Office') && html.includes('c. 397–400'), 'titles, places and original dates');
    assert.ok(html.includes('data:image/jpeg;base64,/9j/2Q=='), 'the thumbnail is inside the file');
    assert.ok(!/src="http|href="http/.test(html), 'nothing is loaded from the internet');
    assert.equal(monthlySnapshot(repo, backup, '2026-11-20T03:00:00Z'), null, 'one snapshot a month');
    const status = writeStatus(repo, { mirror: NOW, snapshot: '2026-11' });
    assert.equal(status.firstBackup, NOW);
    assert.equal(writeStatus(repo, { mirror: '2026-11-11T03:00:00Z' }).firstBackup, NOW, 'the first backup stays the first');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
  }
});

test('the daily backup runs end to end without Git, and a second run changes nothing in the data', async () => {
  const repo = sampleRepo();
  const backup = mkdtempSync(join(tmpdir(), 'loci-backup-drive-'));
  try {
    const report = await dailyBackup({ dataRepo: repo, backupFolder: backup }, { useGit: false, enrich: false, now: NOW });
    assert.ok(report.some(line => line.startsWith('catalog.json rebuilt')));
    assert.ok(existsSync(join(backup, 'snapshots', '2026-11', 'catalog.html')));
    const catalog = readFileSync(join(repo, 'catalog.json'), 'utf8');
    const again = await dailyBackup({ dataRepo: repo, backupFolder: backup }, { useGit: false, enrich: false, now: '2026-11-11T03:00:00Z' });
    assert.ok(again.includes('catalog.json already up to date.'));
    assert.equal(readFileSync(join(repo, 'catalog.json'), 'utf8'), catalog);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(backup, { recursive: true, force: true });
  }
});

test('the yearly archive holds the data, the exports and a note on restoring', () => {
  const repo = sampleRepo();
  const drive = mkdtempSync(join(tmpdir(), 'loci-archive-'));
  try {
    const folder = fullArchive(repo, drive, NOW);
    assert.ok(folder.endsWith('my-loci-library-archive-2026-11-10'));
    assert.ok(existsSync(join(folder, 'data', 'images', 'thumb', `${COVER_ID}.jpg`)), 'covers are included');
    assert.ok(existsSync(join(folder, 'exports', 'catalog.html')));
    assert.ok(readFileSync(join(folder, 'README.txt'), 'utf8').includes('git clone history.bundle'));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(drive, { recursive: true, force: true });
  }
});

test('each tool has a matching .cmd and .sh launcher that runs it from its own folder', () => {
  for (const [folder, script] of [['loci-backup', 'loci-backup.mjs'], ['loci-enrich', 'loci-enrich.mjs']]) {
    const cmd = readFileSync(join(here, '..', '..', folder, `${folder}.cmd`), 'utf8');
    const sh = readFileSync(join(here, '..', '..', folder, `${folder}.sh`), 'utf8');
    assert.ok(cmd.includes('cd /d "%~dp0"') && cmd.includes(`node ${script} %*`), `${folder}.cmd`);
    assert.ok(sh.startsWith('#!/bin/sh') && sh.includes('cd "$(dirname "$0")"') && sh.includes(`node ${script} "$@"`), `${folder}.sh`);
  }
});
