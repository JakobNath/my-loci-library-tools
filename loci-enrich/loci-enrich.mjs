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
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readRecords, writeRecord, isGitRepo, git, pullLatest, commitAndPush, holdLock, FOLDERS } from '../shared/data-repo.mjs';
import { editionsToAsk, fillBook, askKey, sourcesOfWritten, isCorrectedNumber, clearWritten, RECHECK_DAYS, RETRY_DAYS } from './enrich.mjs';
import { checkWikidataIds } from './wikidata-ids.mjs';
import { askSources } from './sources.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const MEMORY = join('integrations', 'enrich.json');
// Each book's raw answers, as the sources sent them, compressed: integrations/answers/<edition id>.json.gz.
export const ANSWERS = join('integrations', 'answers');
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
  // wikidataChecked: the day the stored Wikidata IDs were last checked (wikidata-ids.mjs).
  const checked = memory.wikidataChecked ? { wikidataChecked: memory.wikidataChecked } : {};
  writeFileSync(join(dataRepo, MEMORY), `${JSON.stringify({ format: 1, ...checked, books }, null, 2)}\n`);
}

/**
 * Keep a book's raw answers (DATA_FORMAT.md, "integrations/answers/"), so they
 * can be read again if a source changes or closes. The file is rewritten only
 * when an answer differs from the one kept, so a quiet re-check adds nothing to
 * the history. Google Books' answers are not kept (sources.mjs).
 * @returns {boolean} whether the file was written
 */
export function keepAnswers(dataRepo, editionId, key, asked, raw) {
  if (!Object.keys(raw).length) return false;
  const folder = join(dataRepo, ANSWERS);
  const path = join(folder, `${editionId}.json.gz`);
  const sorted = Object.fromEntries(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)));
  if (existsSync(path)) {
    const kept = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
    if (kept.isbn === key && JSON.stringify(kept.answers) === JSON.stringify(sorted)) return false;
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(path, gzipSync(`${JSON.stringify({ format: 1, isbn: key, asked, answers: sorted }, null, 2)}\n`));
  return true;
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
  const clearedLines = [];
  let notFound = 0;
  let missedCount = 0;
  const resting = new Set(); // sources that refused a request: not asked again this run (sources.mjs)
  for (const [i, edition] of asking.entries()) {
    const key = askKey(edition);
    const answer = await askSources(edition.isbn || { lccn: edition.identifiers.lccn, oclc: edition.identifiers.oclc }, { fetchFn, googleBooksKey, resting });
    keepAnswers(dataRepo, edition.id, key, today, answer.raw);
    problemLines.push(...answer.problems.map(problem => `  ${edition.title}: ${problem}`));
    const works = edition.contents.map(entry => byId.get(entry.work)).filter(Boolean);
    let book = { edition, works };
    let previous = memory.books[edition.id] || {};
    const toWrite = new Map();
    // A corrected ISBN: what was filled from the old number came from another book.
    if (isCorrectedNumber(previous.isbn, key)) {
      const reset = clearWritten(book, previous.wrote || {}, now);
      for (const record of [reset.edition, ...reset.works]) if (record !== byId.get(record.id)) toWrite.set(record.id, record);
      const from = Object.fromEntries(Object.entries(previous.from || {}).filter(([field]) => !reset.cleared.includes(field)));
      previous = { ...previous, wrote: reset.wrote, from };
      book = { edition: reset.edition, works: works.map(record => toWrite.get(record.id) || record) };
      if (reset.cleared.length) clearedLines.push(`  ${edition.title} (was ${memory.books[edition.id].isbn}, now ${key}): ${reset.cleared.join(', ')}`);
    }
    const result = fillBook(book, answer.found, previous, now);
    for (const record of result.changed) toWrite.set(record.id, record);
    for (const record of toWrite.values()) { writeRecord(dataRepo, record); byId.set(record.id, record); }
    if (result.filled.length) filledLines.push(`  ${edition.title} (${answer.sources.join(', ')}): ${result.filled.join('; ')}`);
    if (result.contents.length) suggestionLines.push(`  ${edition.title} (${key}), ${result.contents.length} works:`, ...result.contents.map(line => `      ${line}`));
    if (!answer.found) notFound++;
    // A source that failed or was resting is remembered, and the book asked again in RETRY_DAYS.
    if (answer.missed.length) missedCount++;
    const from = { ...(previous.from || {}), ...sourcesOfWritten(result.wrote, previous.wrote || {}, answer.answers) };
    memory.books[edition.id] = {
      isbn: key, asked: today, found: Boolean(answer.found), wrote: result.wrote, from,
      ...(answer.missed.length ? { missed: answer.missed } : {}),
    };
    writeMemory(dataRepo, memory);
    if (pauseMs && i < asking.length - 1) await new Promise(done => setTimeout(done, pauseMs));
  }
  // Every 90 days the stored Wikidata IDs are checked again: a merged item's new ID is stored (wikidata-ids.mjs).
  const wikidataLines = [];
  const withIds = [...byId.values()].filter(record => record.type === 'work' && !record.trashed && record.wikidata);
  const lastCheck = memory.wikidataChecked;
  if (withIds.length && (!lastCheck || (Date.parse(today) - Date.parse(lastCheck)) / 86400000 >= RECHECK_DAYS)) {
    try {
      const checked = await checkWikidataIds(withIds, { fetchFn, now });
      for (const record of checked.changed) { writeRecord(dataRepo, record); byId.set(record.id, record); }
      wikidataLines.push(`Wikidata IDs checked again (${withIds.length} works; next in ${RECHECK_DAYS} days): ${checked.lines.length ? `${checked.lines.length} changed.` : 'none changed.'}`, ...checked.lines);
      memory.wikidataChecked = today;
      writeMemory(dataRepo, memory);
    } catch (error) {
      problemLines.push(`  Wikidata IDs: ${error.message}`);
    }
  }
  const lines = [
    `Book data (${today}): asked about ${asking.length} of ${due.length} books due; ${filledLines.length} filled, ${notFound} not known to any source, ${problemLines.length} problems.`,
    ...(googleBooksKey ? [] : ['  Google Books was not asked: there is no "googleBooksKey" in config.json (tools README, "A Google Books key").']),
    ...(resting.size ? [`  Refused by ${[...resting].join(' and ')}, so not asked again this run; try again later (SOURCES.md).`] : []),
    ...(missedCount ? [`  ${missedCount} books were not answered by every source; they are asked again in ${RETRY_DAYS} days.`] : []),
    ...(due.length > asking.length ? [`  ${due.length - asking.length} books are left for the next run.`] : []),
    ...(clearedLines.length ? ['ISBN corrected: cleared what the old number had filled, unless a person had changed it:', ...clearedLines] : []),
    ...(filledLines.length ? ['Filled (empty fields only):', ...filledLines] : []),
    ...(suggestionLines.length ? ['Works a catalog lists inside books entered as one work (offered on the Edit page of each in the app, to use or decline):', ...suggestionLines] : []),
    ...wikidataLines,
    ...(problemLines.length ? [`Problems (these books are asked again in ${RETRY_DAYS} days):`, ...problemLines] : []),
  ];
  if (useGit && commit && (asking.length || wikidataLines.length)) {
    if (commitAndPush(dataRepo, [FOLDERS.edition, FOLDERS.work, MEMORY, ANSWERS], `Fill book data for ${filledLines.length} books`)) lines.push('Committed and pushed.');
  }
  if (reportFile) writeFileSync(reportFile, `${lines.join('\n')}\n`);
  return lines;
}

// Run from the command line (not when loaded by loci-backup or the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const limitAt = args.indexOf('--limit');
  let release = () => {};
  try {
    const { dataRepo, googleBooksKey } = readConfig();
    const useGit = !args.includes('--no-git') && isGitRepo(dataRepo);
    if (useGit) { release = holdLock(dataRepo, 'loci-enrich'); pullLatest(dataRepo); }
    const lines = await runEnrich(dataRepo, { useGit, googleBooksKey, limit: limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity });
    console.log(lines.join('\n'));
  } catch (error) {
    console.error(`loci-enrich stopped: ${error.message}`);
    process.exitCode = 1;
  } finally {
    release();
  }
}
