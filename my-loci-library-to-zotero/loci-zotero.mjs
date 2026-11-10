// my-loci-library-to-zotero: send the catalog one way into Zotero
// (PLAN.md, "my-loci-library-to-zotero"). Safe to run any number of times.
//
// Run: node loci-zotero.mjs [--collection "Loci test"] [--no-git]
//
// config.json (beside the tools, never committed) needs, besides "dataRepo":
//   "zoteroUserId": the number shown at zotero.org/settings/keys ("Your userID for use in API calls")
//   "zoteroKey":    a key made on that page with "Allow library access" and "Allow write access"

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, readRecords, isGitRepo, git, commitAndPush } from '../shared/data-repo.mjs';
import { connectToZotero } from './zotero-api.mjs';
import { sendToZotero } from './zotero-sync.mjs';

// A full copy of each item already in Zotero, taken before the companion first changes it,
// so any change can be undone by hand. Kept on this laptop (not committed).
const BEFORE = join(dirname(fileURLToPath(import.meta.url)), 'before');

const LINKS = join('integrations', 'zotero-links.json');
const toolsFolder = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load the link file, run one sync, and keep the link file saved as it goes
 * (after every batch, and at the end even after an error), so a run that is
 * stopped part-way never forgets what it already sent.
 */
export async function runZotero(dataRepo, zotero, options = {}) {
  const path = join(dataRepo, LINKS);
  const links = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { format: 1, collection: null, items: {} };
  const save = () => {
    mkdirSync(join(dataRepo, 'integrations'), { recursive: true });
    const items = Object.fromEntries(Object.entries(links.items).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(path, `${JSON.stringify({ format: 1, collection: links.collection, items }, null, 2)}\n`);
  };
  try {
    return await sendToZotero(readRecords(dataRepo), links, zotero, { ...options, save });
  } finally {
    save();
  }
}

// Run from the command line (not when loaded by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const started = Date.now();
  try {
    const { dataRepo } = readConfig();
    const config = JSON.parse(readFileSync(join(toolsFolder, 'config.json'), 'utf8'));
    if (!config.zoteroUserId || !config.zoteroKey) throw new Error('config.json needs "zoteroUserId" and "zoteroKey" (the tools README explains where to find them).');
    const useGit = !args.includes('--no-git') && isGitRepo(dataRepo);
    console.log(`Reading the catalog in ${dataRepo}…`);
    if (useGit) git(dataRepo, 'pull', '--ff-only');
    const collectionAt = args.indexOf('--collection');
    const lines = await runZotero(dataRepo, connectToZotero({ userId: String(config.zoteroUserId), key: config.zoteroKey }), {
      collectionName: collectionAt >= 0 ? args[collectionAt + 1] : 'My Loci Library',
      appUrl: config.appUrl,
      onProgress: text => console.log(text),
      keepBefore: item => {
        mkdirSync(BEFORE, { recursive: true });
        const file = join(BEFORE, `${item.key}.json`);
        if (!existsSync(file)) writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
      },
    });
    if (useGit && commitAndPush(dataRepo, [LINKS], 'Update the Zotero links')) lines.push('Link file committed and pushed.');
    lines.push(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s. Zotero on this laptop picks the changes up with its next sync.`);
    console.log(lines.join('\n'));
  } catch (error) {
    console.error(`loci-zotero stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
