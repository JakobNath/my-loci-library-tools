// The parts of loci-backup (PLAN.md, "Backups"), each usable on its own and
// each safe to run again: rebuild catalog.json, mirror the data repository
// to the backup folder (changed files only), save the monthly snapshot of the
// exports, make the yearly full archive, and keep backup-status.json, which
// the app reads to show the last backup and the yearly reminder.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords, readStoredRecords, isGitRepo, git } from '../shared/data-repo.mjs';
import { buildLibrary } from '../core/library.js';
import { catalogCsv, catalogJson, cslJson, bibtex } from '../core/exports.js';
import { catalogHtml } from './html-catalog.mjs';

export const STATUS_FILE = 'backup-status.json';

const readJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/**
 * Rebuild catalog.json from the record files. A test catalog keeps its
 * "testData" mark. The file is rewritten only when a record changed, so an
 * unchanged catalog makes no commit.
 * @returns {boolean} whether catalog.json changed
 */
export function rebuildCatalog(dataRepo, built) {
  const path = join(dataRepo, 'catalog.json');
  const old = readJson(path);
  const { format, ...lists } = JSON.parse(catalogJson(readStoredRecords(dataRepo), built));
  delete lists.built;
  const fresh = { format, built, ...(old && old.testData ? { testData: true } : {}), ...lists };
  if (old && JSON.stringify({ ...old, built: null }) === JSON.stringify({ ...fresh, built: null })) return false;
  writeFileSync(path, `${JSON.stringify(fresh, null, 2)}\n`);
  return true;
}

/**
 * Copy every file of `from` into `to` that is missing there or differs in
 * size or time. Git's own folder is left out (the archive keeps the history).
 * Files are never deleted from the backup.
 * @returns {number} files copied
 */
export function mirrorFolder(from, to) {
  let copied = 0;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    if (name === '.git') continue;
    const source = join(from, name);
    const target = join(to, name);
    const info = statSync(source);
    if (info.isDirectory()) { copied += mirrorFolder(source, target); continue; }
    const there = existsSync(target) ? statSync(target) : null;
    if (there && there.size === info.size && Math.abs(there.mtimeMs - info.mtimeMs) < 2000) continue;
    copyFileSync(source, target);
    utimesSync(target, info.atime, info.mtime);
    copied++;
  }
  return copied;
}

/** The exports and the HTML catalog, written into `folder`. */
export function writeExports(dataRepo, folder, built) {
  // The exports never write records, so a catalog ahead of these tools is still backed up.
  const records = readRecords(dataRepo, { allowNewer: true });
  const library = buildLibrary(records);
  const settings = readJson(join(dataRepo, 'settings.json')) || {};
  const thumbnail = id => {
    const path = join(dataRepo, 'images', 'thumb', `${id}.jpg`);
    return existsSync(path) ? readFileSync(path) : null;
  };
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'catalog.csv'), catalogCsv(library.entries, { dateStyle: settings.dateStyle }));
  writeFileSync(join(folder, 'catalog.json'), catalogJson(records, built));
  writeFileSync(join(folder, 'catalog.csl.json'), cslJson(library.entries, library.worksById, library.authorsById));
  writeFileSync(join(folder, 'catalog.bib'), bibtex(library.entries, library.worksById, library.authorsById));
  writeFileSync(join(folder, 'catalog.html'), catalogHtml(library, thumbnail, { built, dateStyle: settings.dateStyle }));
}

/**
 * The monthly snapshot: the exports in snapshots/<year-month>/, once a month.
 * @returns {string|null} the month saved, or null if this month already has one
 */
export function monthlySnapshot(dataRepo, backupFolder, built) {
  const month = built.slice(0, 7);
  const folder = join(backupFolder, 'snapshots', month);
  if (existsSync(join(folder, 'catalog.html'))) return null;
  writeExports(dataRepo, folder, built);
  return month;
}

/**
 * The yearly full archive (PLAN.md, "Yearly"): every file including covers,
 * the exports, and the whole history as one Git bundle, in a dated folder.
 * @returns {string} the archive's folder
 */
export function fullArchive(dataRepo, archiveRoot, built) {
  const folder = join(archiveRoot, `my-loci-library-archive-${built.slice(0, 10)}`);
  mirrorFolder(dataRepo, join(folder, 'data'));
  writeExports(dataRepo, join(folder, 'exports'), built);
  if (isGitRepo(dataRepo)) git(dataRepo, 'bundle', 'create', join(folder, 'history.bundle'), '--all');
  writeFileSync(join(folder, 'README.txt'), [
    'My Loci Library: full archive, made ' + built.slice(0, 10) + '.',
    '',
    'data/      every record and picture, as in the data repository',
    'exports/   the catalog as CSV, JSON, CSL-JSON, BibTeX, and catalog.html (opens in any browser)',
    'history.bundle   the full Git history; restore with: git clone history.bundle my-loci-library-data',
    '',
  ].join('\n'));
  return folder;
}

/**
 * Update backup-status.json in the data repository (DATA_FORMAT.md, "backup-status.json").
 * @param {{ mirror?: string, snapshot?: string, archive?: string }} done what was done, with when
 */
export function writeStatus(dataRepo, done) {
  const path = join(dataRepo, STATUS_FILE);
  const old = readJson(path) || { format: 1, firstBackup: null, lastMirror: null, lastSnapshot: null, lastArchive: null };
  const status = {
    format: 1,
    firstBackup: old.firstBackup || done.mirror || done.archive || null,
    lastMirror: done.mirror || old.lastMirror,
    lastSnapshot: done.snapshot || old.lastSnapshot,
    lastArchive: done.archive || old.lastArchive,
  };
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`);
  return status;
}
