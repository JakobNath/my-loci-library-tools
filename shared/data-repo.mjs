// What every tool needs: the settings in config.json, the record files of a
// data repository, and Git. Node's built-in modules only, on Windows and Linux.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { recordToFileText, migrate, FORMAT_VERSION } from '../core/records.js';

const toolsFolder = join(dirname(fileURLToPath(import.meta.url)), '..');

// The folder of each record type in a data repository (DATA_FORMAT.md, "Files").
export const FOLDERS = { work: 'works', edition: 'editions', copy: 'copies', author: 'authors', wishlist: 'wishlist', set: 'sets' };

/**
 * This laptop's settings, from config.json beside the tools (copy
 * config.example.json to make it). Paths may be relative to the tools folder.
 * @returns {{ dataRepo: string, backupFolder: string|null, googleBooksKey: string }}
 */
export function readConfig(file = join(toolsFolder, 'config.json')) {
  if (!existsSync(file)) {
    throw new Error(`No config.json. Copy config.example.json to config.json in ${toolsFolder} and fill in the folders.`);
  }
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (!config.dataRepo) throw new Error('config.json needs "dataRepo": the folder of the data repository on this laptop.');
  return {
    dataRepo: resolve(toolsFolder, config.dataRepo),
    backupFolder: config.backupFolder ? resolve(toolsFolder, config.backupFolder) : null,
    googleBooksKey: config.googleBooksKey || '',
  };
}

/**
 * Every record in a data repository, in this format version: older records
 * are upgraded as they are read (core/records.js, migrate). Their files are
 * not changed until a tool writes the record.
 *
 * A record in a newer format than these tools know stops the tool, because
 * writing it back would drop the fields they do not know (the app may be
 * updated before the tools). Only a tool that never writes records, such as
 * the backup's exports, passes { allowNewer: true }.
 */
export function readRecords(dataRepo, { allowNewer = false } = {}) {
  const records = readStoredRecords(dataRepo);
  const newest = Math.max(0, ...records.map(record => record.format));
  if (!allowNewer && newest > FORMAT_VERSION) {
    throw new Error(`The catalog has records in data format ${newest}; these tools know format ${FORMAT_VERSION}. `
      + 'Update the tools first (git pull in the tools folder). Nothing was changed.');
  }
  return records.map(migrate);
}

/**
 * Every record exactly as its file stores it, in that file's format version.
 * Only for catalog.json, whose records must match their files, so a device can
 * tell which files it need not download (DATA_FORMAT.md, "catalog.json").
 */
export function readStoredRecords(dataRepo) {
  const records = [];
  for (const folder of Object.values(FOLDERS)) {
    const path = join(dataRepo, folder);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path).filter(file => file.endsWith('.json')).sort()) {
      records.push(JSON.parse(readFileSync(join(path, name), 'utf8')));
    }
  }
  return records;
}

/** Write one record to its file, in the fixed form of DATA_FORMAT.md. Never one newer than these tools know. */
export function writeRecord(dataRepo, record) {
  if (record.format > FORMAT_VERSION) throw new Error(`Record ${record.id} is in data format ${record.format}; these tools know format ${FORMAT_VERSION}. Update the tools first.`);
  writeFileSync(join(dataRepo, FOLDERS[record.type], `${record.id}.json`), recordToFileText(record));
}

/** Whether a folder is a Git working copy. */
export const isGitRepo = folder => existsSync(join(folder, '.git'));

/** Run git in a folder; returns its output. Throws with Git's own message if it fails. */
export function git(folder, ...args) {
  return execFileSync('git', args, { cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Commit the given paths (if any changed) and push. Never commits anything else.
 * @returns {boolean} whether a commit was made
 */
export function commitAndPush(folder, paths, message) {
  const present = paths.filter(path => existsSync(join(folder, path)));
  if (!present.length) return false;
  git(folder, 'add', '--', ...present);
  if (!git(folder, 'diff', '--cached', '--name-only')) return false;
  git(folder, 'commit', '-m', message);
  git(folder, 'push');
  return true;
}
