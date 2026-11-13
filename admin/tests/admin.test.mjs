// The admin page (admin/admin.mjs): its Markdown reader, its chapters, and a
// server that answers only this laptop and runs tools only from its own page.
// No real tool is run here: the tests hand the server a stand-in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { markdownToHtml, sectionOf } from '../markdown.mjs';
import { CHAPTERS } from '../chapters.mjs';
import { createAdminServer, buildPage, sourceText, TOOLS } from '../admin.mjs';

const toolsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appRepo = resolve(toolsFolder, '..', 'my-loci-library');
const noNetwork = async () => { throw new Error('no network in the tests'); };

test('the Markdown reader escapes everything and knows headings, lists, tables, code and links', () => {
  const html = markdownToHtml('## Title\n\nA <b>bold</b> claim with `code` and **strong** words.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```\nx < y\n```\n\n[GitHub](https://github.com) and [a file](HOW_IT_WORKS.md)');
  assert.ok(html.includes('<h2>Title</h2>'));
  assert.ok(html.includes('A &lt;b&gt;bold&lt;/b&gt; claim'), 'no HTML from a document reaches the page');
  assert.ok(html.includes('<code>code</code>') && html.includes('<strong>strong</strong>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(html.includes('<th>A</th>') && html.includes('<td>2</td>'));
  assert.ok(html.includes('<pre><code>x &lt; y</code></pre>'));
  assert.ok(html.includes('<a href="https://github.com" target="_blank" rel="noopener">GitHub</a>'));
  assert.ok(html.includes('a file (<code>HOW_IT_WORKS.md</code>)'), 'a link to a file is named, not followed');
  assert.ok(markdownToHtml('# A', { headingShift: 1 }).startsWith('<h2>'));
});

test('a section runs to the next heading of its level, and sections can be left out', () => {
  const doc = '# Doc\n\nIntro\n\n## One\n\nFirst\n\n### Inside\n\nDeeper\n\n## Two\n\nSecond\n\n## License\n\nMIT\n';
  assert.equal(sectionOf(doc, 'One').trim(), 'First\n\n### Inside\n\nDeeper');
  assert.equal(sectionOf(doc, 'Missing'), null);
  const whole = sourceText(doc, { leaveOut: ['License'] });
  assert.ok(whole.includes('Second') && !whole.includes('MIT') && !whole.includes('# Doc'));
  assert.throws(() => sourceText(doc, { section: 'Gone' }), /chapters\.mjs/);
});

test('every chapter names a section that its document still has', { skip: !existsSync(appRepo) && 'the app repository is not beside the tools' }, () => {
  for (const chapter of CHAPTERS) {
    for (const source of chapter.sources) {
      const file = join(source.repo === 'tools' ? toolsFolder : appRepo, ...source.file.split('/'));
      assert.ok(existsSync(file), `${chapter.title}: ${source.file}`);
      if (source.section) assert.notEqual(sectionOf(readFileSync(file, 'utf8'), source.section), null, `${chapter.title}: "${source.section}" in ${source.file}`);
    }
  }
});

test('the page holds the contents, every chapter and the tools\' buttons', { skip: !existsSync(appRepo) && 'the app repository is not beside the tools' }, async () => {
  const page = await buildPage({ appRepo, toolsFolder, dataRepo: null, fetchFn: noNetwork });
  for (const chapter of CHAPTERS) assert.ok(page.includes(`id="${chapter.id}"`), chapter.title);
  for (const id of Object.keys(TOOLS)) assert.ok(page.includes(`data-tool="${id}"`), id);
  assert.ok(!page.includes('class="problem"'), 'every document was found');
  assert.ok(page.includes('From HOW_IT_WORKS.md, &quot;The parts&quot;; change it there.'));
});

test('each tool the page names exists beside the admin folder, with its launchers', () => {
  for (const [id, tool] of Object.entries(TOOLS)) assert.ok(existsSync(join(toolsFolder, ...tool.script.split('/'))), id);
  const here = join(toolsFolder, 'admin');
  assert.ok(readdirSync(here).includes('admin.cmd') && readdirSync(here).includes('admin.sh'));
  assert.ok(readFileSync(join(here, 'admin.cmd'), 'utf8').includes('node admin.mjs %*'));
  assert.ok(readFileSync(join(here, 'admin.sh'), 'utf8').startsWith('#!/bin/sh'));
});

// One request to the test server: its status and body.
function ask(port, { method = 'GET', path = '/', headers = {}, body = '' } = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => done({ status: response.statusCode, text }));
    });
    req.on('error', fail);
    req.end(body);
  });
}

test('the server answers only this laptop, and runs a tool only when its own page asks', async () => {
  const ran = [];
  const server = await createAdminServer({ port: 0, appRepo, toolsFolder, fetchFn: noNetwork, run: async (tool, input) => { ran.push([tool, input]); return { ok: true, output: 'stand-in ran' }; } });
  const { port } = server.address();
  const own = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await ask(port, { headers: { host: 'example.com' } })).status, 403, 'another host name is refused');
    const run = (origin, tool = 'backup') => ask(port, { method: 'POST', path: '/run', headers: { ...(origin ? { origin } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ tool, input: {} }) });
    assert.equal((await run('https://evil.example')).status, 403, 'a web site cannot press a button');
    assert.equal((await run(undefined)).status, 403, 'nor a request with no origin');
    assert.equal(ran.length, 0);
    const answer = await run(own);
    assert.equal(answer.status, 200);
    assert.deepEqual(JSON.parse(answer.text), { ok: true, output: 'stand-in ran' });
    assert.deepEqual(ran, [['backup', {}]]);
    assert.equal((await run(own, 'format-the-disk')).status, 404, 'only the named tools');
    assert.equal((await ask(port, { path: '/admin.css' })).status, 200);
    assert.equal((await ask(port, { path: '/../config.json' })).status, 404, 'no other file is served');
  } finally {
    server.close();
  }
});

test('the Logos button needs the export\'s path', () => {
  assert.throws(() => TOOLS.logos.args({ file: '  ' }), /full path/);
  assert.deepEqual(TOOLS.logos.args({ file: 'C:/x/export.csv', full: true }), ['C:/x/export.csv', '--full']);
});

test('a path pasted with quotes is read without them', () => {
  assert.deepEqual(TOOLS.logos.args({ file: ' "C:\Users\me\Logos export.csv" ' }), ['C:\Users\me\Logos export.csv']);
  assert.throws(() => TOOLS.logos.args({ file: '""' }), /full path/);
});

test('a second start says the port is taken, and a trial page runs no tool', async () => {
  const ran = [];
  const server = await createAdminServer({ port: 0, appRepo, toolsFolder, fetchFn: noNetwork, isTrial: true, run: async tool => { ran.push(tool); return { ok: true, output: '' }; } });
  const { port } = server.address();
  try {
    await assert.rejects(createAdminServer({ port, appRepo, toolsFolder, fetchFn: noNetwork }), { code: 'EADDRINUSE' });
    const answer = await ask(port, { method: 'POST', path: '/run', headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' }, body: JSON.stringify({ tool: 'backup' }) });
    assert.equal(answer.status, 409);
    assert.match(JSON.parse(answer.text).output, /--data/);
    assert.deepEqual(ran, []);
  } finally {
    server.close();
  }
});
