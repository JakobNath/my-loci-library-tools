// The known sets' lists (sets/*.txt, copied from the app by update-core),
// read for the tools: a Logos resource of a known set takes its volume's works.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKnownSet } from '../core/known-sets.js';

const setsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'sets');

/**
 * Every list in the folder that reads without problems; a list with problems
 * is left out, since a half-read list could give a volume the wrong works.
 */
export function readKnownSets(folder = setsFolder) {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(name => name.endsWith('.txt')).sort()
    .map(name => parseKnownSet(readFileSync(join(folder, name), 'utf8')))
    .filter(set => !set.problems.length);
}
