// Copies the app repository's core/ folder, and its known sets' lists in
// sets/, into this repository. The app repository is expected to sit next to
// this one.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..', 'my-loci-library');

if (!existsSync(join(app, 'core'))) {
  console.error('Cannot find ' + join(app, 'core') + '. Clone my-loci-library next to this folder.');
  process.exit(1);
}
for (const folder of ['core', 'sets']) {
  rmSync(join(here, folder), { recursive: true, force: true });
  if (!existsSync(join(app, folder))) continue;
  cpSync(join(app, folder), join(here, folder), { recursive: true });
  console.log('Copied ' + folder + ' from ' + join(app, folder));
}
