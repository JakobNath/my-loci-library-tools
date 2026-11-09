// Copies the app repository's core/ folder into this repository's core/.
// The app repository is expected to sit next to this one.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, '..', 'my-loci-library', 'core');
const target = join(here, 'core');

if (!existsSync(source)) {
  console.error('Cannot find ' + source + '. Clone my-loci-library next to this folder.');
  process.exit(1);
}
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log('Copied core from ' + source);
