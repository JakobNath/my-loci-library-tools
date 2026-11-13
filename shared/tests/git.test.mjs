// Git between the laptop and the phones, with real Git in temporary folders:
// a "GitHub" (a bare repository), the laptop's copy, and a phone's copy.
// Run with `node --test` in the tools folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { git, pullLatest, commitAndPush } from '../data-repo.mjs';

// Three folders: github (bare), laptop and phone, each holding one record file.
function threeCopies() {
  const root = mkdtempSync(join(tmpdir(), 'loci-git-'));
  const github = join(root, 'github');
  mkdirSync(github);
  git(github, 'init', '--bare', '--initial-branch=main');
  const copy = name => {
    git(root, 'clone', github, name);
    const folder = join(root, name);
    git(folder, 'config', 'user.name', 'Test');
    git(folder, 'config', 'user.email', 'test@example.invalid');
    git(folder, 'config', 'core.autocrlf', 'false');
    return folder;
  };
  const laptop = copy('laptop');
  mkdirSync(join(laptop, 'works'));
  writeFileSync(join(laptop, 'works', 'a.json'), '{ "title": "Confessions" }\n');
  git(laptop, 'checkout', '-B', 'main');
  git(laptop, 'add', '.');
  git(laptop, 'commit', '-m', 'Start');
  git(laptop, 'push', '-u', 'origin', 'main');
  const phone = copy('phone');
  return { root, laptop, phone };
}

// The phone saves a file and sends it, as a sync does.
function phoneSaves(phone, name, text) {
  writeFileSync(join(phone, 'works', name), text);
  git(phone, 'add', '.');
  git(phone, 'commit', '-m', `Phone saves ${name}`);
  git(phone, 'push');
}

test('a phone saving while a laptop tool works does not stop the tool: both changes arrive', () => {
  const { root, laptop, phone } = threeCopies();
  try {
    pullLatest(laptop);
    phoneSaves(phone, 'b.json', '{ "title": "City of God" }\n');
    writeFileSync(join(laptop, 'works', 'c.json'), '{ "title": "Enchiridion" }\n');
    assert.equal(commitAndPush(laptop, ['works'], 'Laptop fills book data'), true);
    git(phone, 'pull', '--ff-only');
    assert.equal(readFileSync(join(phone, 'works', 'c.json'), 'utf8'), '{ "title": "Enchiridion" }\n', 'the phone has the laptop\'s file');
    assert.equal(readFileSync(join(laptop, 'works', 'b.json'), 'utf8'), '{ "title": "City of God" }\n', 'the laptop has the phone\'s file');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a commit the laptop could not send earlier does not stop the next pull', () => {
  const { root, laptop, phone } = threeCopies();
  try {
    phoneSaves(phone, 'b.json', '{ "title": "City of God" }\n');
    // An older run left a commit here that never reached GitHub.
    writeFileSync(join(laptop, 'works', 'c.json'), '{ "title": "Enchiridion" }\n');
    git(laptop, 'add', '.');
    git(laptop, 'commit', '-m', 'Left behind');
    pullLatest(laptop);
    assert.match(readFileSync(join(laptop, 'works', 'b.json'), 'utf8'), /City of God/);
    assert.match(readFileSync(join(laptop, 'works', 'c.json'), 'utf8'), /Enchiridion/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('when laptop and phone changed the same record, the tool stops with a plain message and leaves the folder usable', () => {
  const { root, laptop, phone } = threeCopies();
  try {
    phoneSaves(phone, 'a.json', '{ "title": "Confessions", "notes": "from the phone" }\n');
    writeFileSync(join(laptop, 'works', 'a.json'), '{ "title": "Confessions", "pages": "311" }\n');
    assert.throws(() => commitAndPush(laptop, ['works'], 'Laptop fills book data'), /changed the same record/);
    assert.equal(git(laptop, 'status', '--porcelain'), '', 'no half-finished join is left behind');
    assert.match(readFileSync(join(laptop, 'works', 'a.json'), 'utf8'), /311/, 'the laptop\'s change is kept');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
