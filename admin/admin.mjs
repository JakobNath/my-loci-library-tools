// The admin page: one page on this laptop with the project's handbook and a
// button for each laptop tool (PLAN.md, "Deferred and out of scope": "A laptop
// admin page"). A small web server built on Node's own http module serves it
// at http://127.0.0.1:8650/, reachable from this laptop only. Each button runs
// the same tool as the command line, as its own Node process; the tools still
// run from the command line as before.
// Run: node admin.mjs [--port 8650] [--no-open]   (or admin.cmd / admin.sh)

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAPTERS, chapterNumber } from './chapters.mjs';
import { markdownToHtml, sectionOf, escapeHtml } from './markdown.mjs';
import { readConfig, FOLDERS } from '../shared/data-repo.mjs';
import { APP_URL } from '../my-loci-library-to-zotero/zotero-items.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TOOLS_FOLDER = resolve(here, '..');
// The app's repository, expected beside this one (as update-core expects); its
// documents are read from the published app when it is not there.
const APP_REPO = resolve(TOOLS_FOLDER, '..', 'my-loci-library');
export const PORT = 8650;

/**
 * The tools the buttons run: the script, beside this folder, and its arguments
 * from what the page sent. A tool that changes something outside the catalog
 * (Zotero) asks the page to confirm first.
 */
export const TOOLS = {
  backup: { label: 'Back up now', script: 'loci-backup/loci-backup.mjs', args: () => [] },
  enrich: { label: 'Fill book data', script: 'loci-enrich/loci-enrich.mjs', args: () => [] },
  sources: { label: 'Check the sources', script: 'loci-enrich/check-sources.mjs', args: () => [] },
  logos: {
    label: 'Import a Logos export', script: 'logos-to-my-loci-library/logos-import.mjs',
    args: ({ file, full }) => {
      if (!file || !String(file).trim()) throw new Error('Give the full path of the Logos export (a .csv file).');
      return [String(file).trim(), ...(full ? ['--full'] : [])];
    },
  },
  covers: { label: 'Fetch Logos covers', script: 'logos-to-my-loci-library/logos-import.mjs', args: () => ['--covers', '200'] },
  zotero: { label: 'Send to Zotero', script: 'my-loci-library-to-zotero/loci-zotero.mjs', args: () => [] },
};

/** Run one tool as its own Node process; resolves with what it printed. */
export function runTool(id, input = {}, toolsFolder = TOOLS_FOLDER) {
  const tool = TOOLS[id];
  if (!tool) return Promise.reject(new Error(`No tool named "${id}".`));
  const args = tool.args(input);
  const script = join(toolsFolder, ...tool.script.split('/'));
  return new Promise(done => {
    const child = spawn(process.execPath, [script, ...args], { cwd: dirname(script), windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => done({ ok: false, output: `${output}${error.message}` }));
    child.on('close', code => done({ ok: code === 0, output: output.trim() || (code === 0 ? 'Done.' : `Stopped (code ${code}).`) }));
  });
}

// ---------- the documents ----------

const fetched = new Map();
async function readDocument({ repo, file }, { appRepo, toolsFolder, fetchFn }) {
  const local = join(repo === 'tools' ? toolsFolder : appRepo, ...file.split('/'));
  if (existsSync(local)) return readFileSync(local, 'utf8');
  if (repo === 'tools') throw new Error(`${file} is missing from the tools folder.`);
  if (!fetched.has(file)) {
    const response = await fetchFn(new URL(file, APP_URL));
    if (!response.ok) throw new Error(`${file} could not be read (the app's folder is not beside the tools, and the published app answered ${response.status}).`);
    fetched.set(file, await response.text());
  }
  return fetched.get(file);
}

/** A source's text: its section, or the whole document without its title and the sections left out. */
export function sourceText(markdown, { section, leaveOut = [] }) {
  const text = section ? sectionOf(markdown, section) : markdown.replace(/^#\s.*\n/, '');
  if (text === null) throw new Error(`The section "${section}" is missing; the chapter list (admin/chapters.mjs) needs its new name.`);
  // A section left out goes with everything under it, up to the next heading of its level or higher.
  const lines = text.split('\n');
  const kept = [];
  let skipping = 0; // the level of the heading being left out, or 0
  for (const line of lines) {
    const heading = line.match(/^(#+)\s+(.*)$/);
    if (heading && skipping && heading[1].length <= skipping) skipping = 0;
    if (heading && leaveOut.includes(heading[2])) skipping = heading[1].length;
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

const sourceName = ({ repo, file, section }) => `${repo === 'tools' ? 'the tools\' ' : ''}${file}${section ? `, "${section}"` : ''}`;

// ---------- the page ----------

function statusLine(dataRepo) {
  if (!dataRepo) return 'No config.json yet: the tools README, "Setting up on a laptop".';
  const parts = [];
  const status = join(dataRepo, 'backup-status.json');
  if (existsSync(status)) {
    const { lastMirror } = JSON.parse(readFileSync(status, 'utf8'));
    if (lastMirror) parts.push(`Last backup ${lastMirror.slice(0, 16).replace('T', ' at ')}`);
  }
  const editions = join(dataRepo, FOLDERS.edition);
  if (existsSync(editions)) parts.push(`${readdirSync(editions).filter(name => name.endsWith('.json')).length} editions`);
  return parts.join(' · ') || 'The catalog has no backup yet.';
}

function toolsHtml() {
  const button = (id, extra = '') => `<button type="button" class="tool" data-tool="${id}"${extra}>${escapeHtml(TOOLS[id].label)}</button>`;
  return `<div class="tools">
  <p>${button('backup')} ${button('enrich')} ${button('sources')}</p>
  <p><label>Logos export (full path of the .csv) <input name="file" size="48" placeholder="C:\\Users\\…\\Logos export.csv"></label>
    <label class="check"><input type="checkbox" name="full"> it lists the whole Logos library</label> ${button('logos')} ${button('covers')}</p>
  <p>${button('zotero', ' data-confirm="This sends the catalog into your Zotero library (the &quot;My Loci Library&quot; collection). Go on?"')}</p>
  <p class="pages">Laptop pages of the app, opened in this browser where the app is synced:
    <a href="${APP_URL}laptop/covers.html" target="_blank" rel="noopener">Covers from the inbox</a> ·
    <a href="${APP_URL}laptop/contents.html" target="_blank" rel="noopener">Contents to enter</a></p>
  <pre class="output" aria-live="polite" hidden></pre>
</div>`;
}

/**
 * The whole page.
 * @param {{ appRepo?: string, toolsFolder?: string, dataRepo?: string|null, fetchFn?: typeof fetch }} options
 */
export async function buildPage({ appRepo = APP_REPO, toolsFolder = TOOLS_FOLDER, dataRepo = null, fetchFn = fetch } = {}) {
  const contents = CHAPTERS.map((chapter, i) => `<li><a href="#${chapter.id}">${chapterNumber(i)}. ${escapeHtml(chapter.title)}</a></li>`).join('');
  const chapters = [];
  for (const [i, chapter] of CHAPTERS.entries()) {
    const parts = [];
    for (const source of chapter.sources) {
      try {
        const text = sourceText(await readDocument(source, { appRepo, toolsFolder, fetchFn }), source);
        parts.push(`${markdownToHtml(text, { headingShift: 1 })}<p class="source">From ${escapeHtml(sourceName(source))}; change it there.</p>`);
      } catch (error) {
        parts.push(`<p class="problem">${escapeHtml(error.message)}</p>`);
      }
    }
    chapters.push(`<section id="${chapter.id}"><h2>${chapterNumber(i)}. ${escapeHtml(chapter.title)}</h2>
<p class="opening">${escapeHtml(chapter.opening)}</p>${chapter.tools ? toolsHtml() : ''}${parts.join('\n')}</section>`);
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Loci Library · the laptop book</title>
<link rel="stylesheet" href="/tokens.css">
<link rel="stylesheet" href="/admin.css">
</head>
<body>
<main>
<header><h1>My Loci Library</h1><p class="subtitle">The laptop book</p><p class="status">${escapeHtml(statusLine(dataRepo))}</p></header>
<nav aria-label="Contents"><ol class="contents">${contents}</ol></nav>
${chapters.join('\n')}
<footer>Created by Jakob Nath. Served by the tools on this laptop only (<code>admin/admin.mjs</code>).</footer>
</main>
<script type="module" src="/admin.js"></script>
</body>
</html>
`;
}

// ---------- the server ----------

const TYPES = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

/**
 * The server. It answers only requests addressed to this laptop, and runs a
 * tool only when asked from its own page, so no web site open in the browser
 * can press a button.
 * @param {{ port?: number, appRepo?: string, toolsFolder?: string, dataRepo?: string|null, fetchFn?: typeof fetch, run?: typeof runTool }} options
 */
export function createAdminServer({ port = PORT, appRepo = APP_REPO, toolsFolder = TOOLS_FOLDER, dataRepo = null, fetchFn = fetch, run = runTool } = {}) {
  let busy = false;
  const server = createServer(async (request, response) => {
    const own = `127.0.0.1:${server.address().port}`;
    const send = (status, type, body) => { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); };
    if (![own, `localhost:${server.address().port}`].includes(request.headers.host)) return send(403, 'text/plain', 'Only this laptop may use this page.');
    const url = new URL(request.url, `http://${own}`);
    try {
      if (request.method === 'GET' && url.pathname === '/') return send(200, 'text/html; charset=utf-8', await buildPage({ appRepo, toolsFolder, dataRepo, fetchFn }));
      if (request.method === 'GET' && ['/admin.css', '/admin.js'].includes(url.pathname)) {
        return send(200, TYPES[url.pathname.endsWith('.css') ? '.css' : '.js'], readFileSync(join(here, 'page', url.pathname.slice(1))));
      }
      if (request.method === 'GET' && url.pathname === '/tokens.css') {
        return send(200, TYPES['.css'], await readDocument({ repo: 'app', file: 'styles/tokens.css' }, { appRepo, toolsFolder, fetchFn }));
      }
      if (request.method === 'POST' && url.pathname === '/run') {
        if (request.headers.origin !== `http://${own}` && request.headers.origin !== `http://localhost:${server.address().port}`) return send(403, 'text/plain', 'Tools run only from this page.');
        let body = '';
        for await (const chunk of request) body += chunk;
        const { tool, input } = JSON.parse(body || '{}');
        if (!TOOLS[tool]) return send(404, 'application/json', JSON.stringify({ ok: false, output: `No tool named "${tool}".` }));
        if (busy) return send(409, 'application/json', JSON.stringify({ ok: false, output: 'Another tool is still running; wait for it to finish.' }));
        busy = true;
        try {
          return send(200, 'application/json', JSON.stringify(await run(tool, input || {}, toolsFolder)));
        } finally {
          busy = false;
        }
      }
      return send(404, 'text/plain', 'Not here.');
    } catch (error) {
      return send(500, 'application/json', JSON.stringify({ ok: false, output: error.message }));
    }
  });
  return new Promise(ready => server.listen(port, '127.0.0.1', () => ready(server)));
}

// Open the page in the laptop's own browser.
function openBrowser(address) {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', address]] : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
}

// Run from the command line (not when loaded by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const portAt = args.indexOf('--port');
  let dataRepo = null;
  try { ({ dataRepo } = readConfig()); } catch (error) { console.log(error.message); }
  const server = await createAdminServer({ port: portAt >= 0 ? Number(args[portAt + 1]) : PORT, dataRepo });
  const address = `http://127.0.0.1:${server.address().port}/`;
  console.log(`The admin page is at ${address}\nLeave this window open while using it; close it (or press Ctrl+C) to stop.`);
  if (!args.includes('--no-open')) openBrowser(address);
}
