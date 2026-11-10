// loci-sizes: fill catalog heights in the data repository named in
// config.json, then commit them once. Safe to run any number of times.
// Run: node loci-sizes.mjs [--limit 200] [--no-git]
//   --limit N   ask about at most N books this time (the first run on a large
//               catalog can take a while; it carries on where it stopped)
//   --no-git    change the files but do not pull, commit or push

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readRecords, writeRecord, isGitRepo, git, commitAndPush, FOLDERS } from '../shared/data-repo.mjs';
import { fillHeights } from './sizes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CHECKED_FILE = join(here, 'checked.json'); // books the catalog did not know, and when; kept on this laptop

/**
 * Fill heights in a data repository and (unless git is false) commit them.
 * Used by this file's command line and by loci-backup.
 * @returns {Promise<string[]>} the report, one line each
 */
export async function runSizes(dataRepo, { useGit = true, limit = Infinity, fetchFn = fetch, now = new Date().toISOString().slice(0, 19) + 'Z', commit = true, checkedFile = CHECKED_FILE } = {}) {
  const checked = existsSync(checkedFile) ? JSON.parse(readFileSync(checkedFile, 'utf8')) : {};
  const editions = readRecords(dataRepo).filter(record => record.type === 'edition');
  const report = await fillHeights(editions, { fetchFn, now, checked, limit, pauseMs: fetchFn === fetch ? 300 : 0 });
  for (const edition of report.changed) writeRecord(dataRepo, edition);
  writeFileSync(checkedFile, `${JSON.stringify(checked, null, 2)}\n`);
  const lines = [`Catalog heights: ${report.filled.length} filled, ${report.unknown} not in the catalog, ${report.failed.length} could not be asked.`];
  for (const item of report.filled) lines.push(`  ${item.title}: ${item.mm / 10} cm`);
  for (const problem of report.failed) lines.push(`  Not asked: ${problem}`);
  if (useGit && commit && report.changed.length) {
    commitAndPush(dataRepo, report.changed.map(edition => `${FOLDERS.edition}/${edition.id}.json`), `Fill catalog heights for ${report.changed.length} books`);
    lines.push('  Committed and pushed.');
  }
  return lines;
}

// Run from the command line (not when loaded by loci-backup or the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf('--limit');
  const useGit = !args.includes('--no-git');
  try {
    const { dataRepo } = readConfig();
    if (useGit && isGitRepo(dataRepo)) git(dataRepo, 'pull', '--ff-only');
    const lines = await runSizes(dataRepo, { useGit: useGit && isGitRepo(dataRepo), limit: limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity });
    console.log(lines.join('\n'));
  } catch (error) {
    console.error(`loci-sizes stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
