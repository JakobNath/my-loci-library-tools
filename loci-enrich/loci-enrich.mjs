// loci-enrich: fill the empty fields of every book with an ISBN from the
// Library of Congress, Open Library and Google Books, in the data repository
// named in config.json, then commit once. Safe to run any number of times.
// Run: node loci-enrich.mjs [--limit 200] [--no-git]
//   --limit N   ask about at most N books this time (a first run on a large
//               catalog takes a while; the next run carries on where it stopped)
//   --no-git    change the files but do not pull, commit or push
// loci-backup runs it every day. The report of the last run is kept in
// last-report.txt beside this file.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readRecords, writeRecord, isGitRepo, git, commitAndPush, FOLDERS } from '../shared/data-repo.mjs';
import { editionsToAsk, fillBook } from './enrich.mjs';
import { askSources } from './sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MEMORY = join('integrations', 'enrich.json');
const REPORT_FILE = join(here, 'last-report.txt');
const PAUSE_MS = 1000; // between books, to be gentle on free public services

const nowText = () => new Date().toISOString().slice(0, 19) + 'Z';

function readMemory(dataRepo) {
  const path = join(dataRepo, MEMORY);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { format: 1, books: {} };
}

// Saved after every book, so a run that is stopped keeps what it did.
function writeMemory(dataRepo, memory) {
  mkdirSync(join(dataRepo, 'integrations'), { recursive: true });
  const books = Object.fromEntries(Object.entries(memory.books).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(join(dataRepo, MEMORY), `${JSON.stringify({ format: 1, books }, null, 2)}\n`);
}

/**
 * Fill empty fields in a data repository and (with useGit) commit them once.
 * Used by this file's command line and by loci-backup.
 * @returns {Promise<string[]>} the report, one line each
 */
export async function runEnrich(dataRepo, { useGit = true, commit = true, limit = Infinity, fetchFn = fetch, googleBooksKey = '', now = nowText(), pauseMs = fetchFn === fetch ? PAUSE_MS : 0, reportFile = REPORT_FILE } = {}) {
  const records = readRecords(dataRepo);
  const byId = new Map(records.map(record => [record.id, record]));
  const memory = readMemory(dataRepo);
  const today = now.slice(0, 10);
  const due = editionsToAsk(records.filter(record => record.type === 'edition'), memory, today);
  const asking = due.slice(0, limit);
  const filledLines = [];
  const suggestionLines = [];
  const problemLines = [];
  let notFound = 0;
  const resting = new Set(); // sources that refused a request: not asked again this run (sources.mjs)
  for (const [i, edition] of asking.entries()) {
    const answer = await askSources(edition.isbn, { fetchFn, googleBooksKey, resting });
    problemLines.push(...answer.problems.map(problem => `  ${edition.title}: ${problem}`));
    const works = edition.contents.map(entry => byId.get(entry.work)).filter(Boolean);
    const result = fillBook({ edition, works }, answer.found, memory.books[edition.id], now);
    for (const record of result.changed) { writeRecord(dataRepo, record); byId.set(record.id, record); }
    if (result.filled.length) filledLines.push(`  ${edition.title} (${answer.sources.join(', ')}): ${result.filled.join('; ')}`);
    if (result.contents.length) suggestionLines.push(`  ${edition.title} (${edition.isbn}), ${result.contents.length} works:`, ...result.contents.map(line => `      ${line}`));
    if (!answer.found) notFound++;
    // A book no source could answer, because of a failure, is asked again next time.
    if (!answer.problems.length || answer.found) {
      memory.books[edition.id] = { isbn: edition.isbn, asked: today, found: Boolean(answer.found), wrote: result.wrote };
      writeMemory(dataRepo, memory);
    }
    if (pauseMs && i < asking.length - 1) await new Promise(done => setTimeout(done, pauseMs));
  }
  const lines = [
    `Book data (${today}): asked about ${asking.length} of ${due.length} books due; ${filledLines.length} filled, ${notFound} not known to any source, ${problemLines.length} problems.`,
    ...(googleBooksKey ? [] : ['  Google Books was not asked: there is no "googleBooksKey" in config.json (tools README, "A Google Books key").']),
    ...(resting.size ? [`  Refused by ${[...resting].join(' and ')}, so not asked again this run; try again later (SOURCES.md).`] : []),
    ...(due.length > asking.length ? [`  ${due.length - asking.length} books are left for the next run.`] : []),
    ...(filledLines.length ? ['Filled (empty fields only):', ...filledLines] : []),
    ...(suggestionLines.length ? ['Contents listed by a catalog, to enter by hand if they are right (nothing was changed):', ...suggestionLines] : []),
    ...(problemLines.length ? ['Problems (these books are asked again next time):', ...problemLines] : []),
  ];
  if (useGit && commit && asking.length) {
    if (commitAndPush(dataRepo, [FOLDERS.edition, FOLDERS.work, MEMORY], `Fill book data for ${filledLines.length} books`)) lines.push('Committed and pushed.');
  }
  if (reportFile) writeFileSync(reportFile, `${lines.join('\n')}\n`);
  return lines;
}

// Run from the command line (not when loaded by loci-backup or the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf('--limit');
  try {
    const { dataRepo, googleBooksKey } = readConfig();
    const useGit = !args.includes('--no-git') && isGitRepo(dataRepo);
    if (useGit) git(dataRepo, 'pull', '--ff-only');
    const lines = await runEnrich(dataRepo, { useGit, googleBooksKey, limit: limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity });
    console.log(lines.join('\n'));
  } catch (error) {
    console.error(`loci-enrich stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
