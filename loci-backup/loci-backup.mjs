// loci-backup: the daily backup (PLAN.md, "Backups"). Safe to run any number
// of times; scheduling is described in the tools README.
//
// Run: node loci-backup.mjs [--no-git] [--no-sizes]
//   1. pull the data repository named in config.json
//   2. rebuild catalog.json, and fill catalog heights (loci-sizes)
//   3. mirror the repository into <backupFolder>/data, changed files only
//   4. once a month, save the exports and the HTML catalog in <backupFolder>/snapshots/<year-month>
//   5. record the backup in backup-status.json, commit what changed (once), and push
//
// Run: node loci-backup.mjs --archive <folder>
//   the yearly full archive (every file including covers, the exports, the
//   whole history) into a dated folder inside <folder>, such as an external drive

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, isGitRepo, git, commitAndPush } from '../shared/data-repo.mjs';
import { rebuildCatalog, mirrorFolder, monthlySnapshot, fullArchive, writeStatus, STATUS_FILE } from './backup.mjs';
import { runSizes } from '../loci-sizes/loci-sizes.mjs';

/**
 * The daily backup. Returns the report, one line each.
 * @param {{ dataRepo: string, backupFolder: string|null }} config
 */
export async function dailyBackup({ dataRepo, backupFolder }, { useGit = true, sizes = true, now = new Date().toISOString().slice(0, 19) + 'Z', fetchFn } = {}) {
  const lines = [];
  if (useGit) { git(dataRepo, 'pull', '--ff-only'); lines.push('Pulled the latest data.'); }
  if (sizes) lines.push(...await runSizes(dataRepo, { useGit, commit: false, now, ...(fetchFn ? { fetchFn } : {}) }));
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
  if (useGit && commitAndPush(dataRepo, ['catalog.json', STATUS_FILE, 'editions'], `Daily backup ${now.slice(0, 10)}`)) lines.push('Committed and pushed.');
  return lines;
}

// Run from the command line (not when loaded by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    const config = readConfig();
    const useGit = !args.includes('--no-git') && isGitRepo(config.dataRepo);
    const archiveAt = args.indexOf('--archive');
    if (archiveAt >= 0) {
      if (!args[archiveAt + 1]) throw new Error('Name the folder for the archive: node loci-backup.mjs --archive "E:\\Loci archive"');
      const now = new Date().toISOString().slice(0, 19) + 'Z';
      if (useGit) git(config.dataRepo, 'pull', '--ff-only');
      const folder = fullArchive(config.dataRepo, resolve(args[archiveAt + 1]), now);
      writeStatus(config.dataRepo, { archive: now });
      if (useGit) commitAndPush(config.dataRepo, [STATUS_FILE], `Yearly archive ${now.slice(0, 10)}`);
      console.log(`Archive saved in ${folder}. The app's yearly reminder is reset.`);
    } else {
      console.log((await dailyBackup(config, { useGit, sizes: !args.includes('--no-sizes') })).join('\n'));
    }
  } catch (error) {
    console.error(`loci-backup stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
