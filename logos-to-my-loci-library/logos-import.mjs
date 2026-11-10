// logos-to-my-loci-library: bring a Logos Library export into the data
// repository named in config.json. Safe to run any number of times.
//
//   node logos-import.mjs <export.csv> [--full] [--no-git]
//       import the export; --full when it lists the whole Logos library
//       (resources missing from it are then marked "gone from Logos")
//   node logos-import.mjs --confirm-links [--no-git]
//       link the suggestions marked "yes" in links-to-confirm.txt
//   node logos-import.mjs --covers 200 [--no-git]
//       fetch up to 200 covers (by ISBN, from Open Library) into images/inbox/,
//       for the laptop covers page; run again to continue where it stopped

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { readConfig, readRecords, writeRecord, isGitRepo, git, commitAndPush } from '../shared/data-repo.mjs';
import { makeId } from '../core/ids.js';
import { parseCsv, decodeExport } from './columns.mjs';
import { importRows, linkEditions } from './import.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const LINKS_FILE = join(here, 'links-to-confirm.txt');
const MEMORY = join('integrations', 'logos-import.json');
const INBOX = join('images', 'inbox');
const coverUrl = isbn => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;

const nowText = () => new Date().toISOString().slice(0, 19) + 'Z';

function readMemory(dataRepo) {
  const path = join(dataRepo, MEMORY);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { format: 1, imported: {} };
}

function writeMemory(dataRepo, memory) {
  mkdirSync(join(dataRepo, 'integrations'), { recursive: true });
  const sorted = { format: 1, imported: Object.fromEntries(Object.entries(memory.imported).sort(([a], [b]) => a.localeCompare(b))) };
  writeFileSync(join(dataRepo, MEMORY), `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * Import an export file. Returns the report, one line each.
 * @param {{ full?: boolean, now?: string, linksFile?: string }} options
 */
export function importFile(dataRepo, file, { full = false, now = nowText(), linksFile = LINKS_FILE } = {}) {
  const rows = parseCsv(decodeExport(readFileSync(file)));
  const memory = readMemory(dataRepo);
  const result = importRows(rows, readRecords(dataRepo), memory, { now, today: now.slice(0, 10), newId: () => makeId(randomBytes(12)), full });
  for (const record of result.changed) writeRecord(dataRepo, record);
  writeMemory(dataRepo, memory);
  if (result.suggestions.length) {
    const lines = result.suggestions.map(item => `no | ${item.editionId} | ${item.workId} | ${item.text}`);
    const old = existsSync(linksFile) ? readFileSync(linksFile, 'utf8').split('\n').filter(line => line.includes('|')) : [];
    writeFileSync(linksFile, [
      '# Suggested links between Logos books and works already in the catalog.',
      '# Change "no" to "yes" on each line that is right, then run: node logos-import.mjs --confirm-links',
      ...old, ...lines, '',
    ].join('\n'));
  }
  return [
    `${rows.length} rows read: ${result.added.length} new books, ${result.updated.length} updated, ${result.kept} unchanged.`,
    ...(full ? [`${result.gone.length} marked gone from Logos (not in this full export).`] : ['A filtered export: nothing was marked gone.']),
    ...(result.back.length ? [`${result.back.length} back in Logos after being marked gone.`] : []),
    ...(result.suggestions.length ? [`${result.suggestions.length} possible links to existing works: see ${linksFile}.`] : []),
    ...result.problems,
    ...result.updated.slice(0, 50).map(title => `  Updated: ${title}`),
    ...result.gone.slice(0, 50).map(title => `  Gone: ${title}`),
  ];
}

/** Link the suggestions marked "yes". Returns the report. */
export function confirmLinks(dataRepo, { now = nowText(), linksFile = LINKS_FILE } = {}) {
  if (!existsSync(linksFile)) return ['No suggestions to confirm.'];
  const lines = readFileSync(linksFile, 'utf8').split('\n');
  const links = lines.filter(line => /^yes\s*\|/i.test(line)).map(line => {
    const [, editionId, workId] = line.split('|').map(part => part.trim());
    return { editionId, workId };
  });
  const changed = linkEditions(links, readRecords(dataRepo), { now, today: now.slice(0, 10) });
  for (const record of changed) writeRecord(dataRepo, record);
  // Lines dealt with (yes or no) leave the file; only the heading stays if nothing is left.
  writeFileSync(linksFile, lines.filter(line => line.startsWith('#') || (line.includes('|') && !/^(yes|no)\s*\|/i.test(line))).join('\n') + '\n');
  return [`${links.length} links confirmed; the others were dropped.`];
}

/**
 * Fetch covers for Logos books into images/inbox/<edition id>.jpg, at most `limit`
 * this run. Books with a cover already, or a file waiting in the inbox, are
 * skipped, so each run carries on where the last stopped. Inbox files of books
 * that now have a cover are removed. Books with no ISBN, or none on Open
 * Library, keep the drawn cover the app shows from their title and author.
 */
export async function fetchCovers(dataRepo, { limit = 200, fetchFn = fetch } = {}) {
  const inbox = join(dataRepo, INBOX);
  mkdirSync(inbox, { recursive: true });
  const editions = readRecords(dataRepo).filter(record => record.type === 'edition' && record.medium === 'logos' && !record.trashed);
  const hasCover = edition => edition.images.some(image => image.kind === 'cover');
  let removed = 0;
  for (const edition of editions.filter(hasCover)) {
    if (existsSync(join(inbox, `${edition.id}.jpg`))) { rmSync(join(inbox, `${edition.id}.jpg`)); removed++; }
  }
  const waiting = new Set(readdirSync(inbox).map(name => name.replace(/\.jpg$/, '')));
  const todo = editions.filter(edition => edition.isbn && !hasCover(edition) && !waiting.has(edition.id)).slice(0, limit);
  let saved = 0;
  let missing = 0;
  for (const edition of todo) {
    try {
      const response = await fetchFn(coverUrl(edition.isbn), { signal: AbortSignal.timeout(15000) });
      if (!response.ok) { missing++; continue; }
      writeFileSync(join(inbox, `${edition.id}.jpg`), Buffer.from(await response.arrayBuffer()));
      saved++;
    } catch {
      missing++;
    }
  }
  return [`Covers: ${saved} saved in images/inbox/, ${missing} not found, ${removed} inbox files removed (their books have covers now).`,
    saved ? 'Open laptop/covers.html in the app to turn them into covers.' : ''].filter(Boolean);
}

// Run from the command line (not when loaded by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  try {
    const { dataRepo } = readConfig();
    const useGit = !args.includes('--no-git') && isGitRepo(dataRepo);
    if (useGit) git(dataRepo, 'pull', '--ff-only');
    let lines;
    let message;
    if (args.includes('--confirm-links')) {
      lines = confirmLinks(dataRepo);
      message = 'Link Logos books to existing works';
    } else if (args.includes('--covers')) {
      lines = await fetchCovers(dataRepo, { limit: Number(args[args.indexOf('--covers') + 1]) || 200 });
      message = 'Fetch covers for Logos books';
    } else {
      const file = args.find(arg => !arg.startsWith('--'));
      if (!file) throw new Error('Name the export file: node logos-import.mjs "C:\\Users\\me\\Downloads\\Library.csv"');
      lines = importFile(dataRepo, resolve(file), { full: args.includes('--full') });
      message = 'Import from Logos';
    }
    if (useGit && commitAndPush(dataRepo, ['works', 'editions', 'copies', 'authors', 'integrations', 'images/inbox'], message)) lines.push('Committed and pushed.');
    console.log(lines.join('\n'));
  } catch (error) {
    console.error(`logos-import stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
