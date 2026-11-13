// loci-backup: the daily backup (PLAN.md, "Backups"). Safe to run any number
// of times; scheduling is described in the tools README.
//
// Run: node loci-backup.mjs [--no-git] [--no-enrich]
//   1. pull the data repository named in config.json
//   2. fill empty book fields from the catalogs (loci-enrich), and rebuild catalog.json
//   3. mirror the repository into <backupFolder>/data, changed files only
//   4. once a month, save the exports and the HTML catalog in <backupFolder>/snapshots/<year-month>
//   5. record the backup in backup-status.json, commit what changed (once), and push
//
// Run: node loci-backup.mjs --archive <folder>
//   the yearly full archive (every file including covers, the exports, the
//   whole history) into a dated folder inside <folder>, such as an external drive

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, isGitRepo, git, pullLatest, commitAndPush, holdLock } from '../shared/data-repo.mjs';
import { rebuildCatalog, mirrorFolder, monthlySnapshot, fullArchive, writeStatus, STATUS_FILE } from './backup.mjs';
import { runEnrich, MEMORY as ENRICH_MEMORY, ANSWERS as ENRICH_ANSWERS } from '../loci-enrich/loci-enrich.mjs';

/**
 * The daily backup. Returns the report, one line each.
 * @param {{ dataRepo: string, backupFolder: string|null, googleBooksKey?: string }} config
 */
export async function dailyBackup({ dataRepo, backupFolder, googleBooksKey = '' }, { useGit = true, enrich = true, now = new Date().toISOString().slice(0, 19) + 'Z', fetchFn } = {}) {
  const lines = [];
  if (useGit) { pullLatest(dataRepo); lines.push('Pulled the latest data.'); }
  // Filling book data is an extra: whatever goes wrong in it (a source down, a
  // record newer than these tools), the backup itself still runs.
  if (enrich) {
    try {
      lines.push(...await runEnrich(dataRepo, { useGit, commit: false, now, googleBooksKey, ...(fetchFn ? { fetchFn } : {}) }));
    } catch (error) {
      lines.push(`Book data was not filled this time (${error.message}). The backup went on.`);
    }
  }
  lines.push(rebuildCatalog(dataRepo, now) ? 'catalog.json rebuilt.' : 'catalog.json already up to date.');
  const done = {};
  if (backupFolder) {
    lines.push(`Mirrored ${mirrorFolder(dataRepo, join(backupFolder, 'data'))} changed files to ${backupFolder}.`);
    done.mirror = now;
    const month = monthlySnapshot(dataRepo, backupFolder, now);
    if (month) { lines.push(`Saved the ${month} snapshot of the exports and the HTML catalog.`); done.snapshot = month; }
  } else {
    lines.push('No backupFolder in config.json, so nothing was mirrored.');
  }
  writeStatus(dataRepo, done);
  if (useGit && commitAndPush(dataRepo, ['catalog.json', STATUS_FILE, 'editions', 'works', ENRICH_MEMORY, ENRICH_ANSWERS], `Daily backup ${now.slice(0, 10)}`)) lines.push('Committed and pushed.');
  return lines;
}

// Run from the command line (not when loaded by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let release = () => {};
  try {
    const config = readConfig();
    const useGit = !args.includes('--no-git') && isGitRepo(config.dataRepo);
    if (useGit) release = holdLock(config.dataRepo, 'loci-backup');
    const archiveAt = args.indexOf('--archive');
    if (archiveAt >= 0) {
      if (!args[archiveAt + 1]) throw new Error('Name the folder for the archive: node loci-backup.mjs --archive "E:\\Loci archive"');
      const now = new Date().toISOString().slice(0, 19) + 'Z';
      if (useGit) pullLatest(config.dataRepo);
      const folder = fullArchive(config.dataRepo, resolve(args[archiveAt + 1]), now);
      writeStatus(config.dataRepo, { archive: now });
      if (useGit) commitAndPush(config.dataRepo, [STATUS_FILE], `Yearly archive ${now.slice(0, 10)}`);
      console.log(`Archive saved in ${folder}. The app's yearly reminder is reset.`);
    } else {
      console.log((await dailyBackup(config, { useGit, enrich: !args.includes('--no-enrich') })).join('\n'));
    }
  } catch (error) {
    console.error(`loci-backup stopped: ${error.message}`);
    process.exitCode = 1;
  } finally {
    release();
  }
}
