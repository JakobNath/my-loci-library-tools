# My Loci Library: rules for every session

My Loci Library is a lightweight, open-source catalog of Jakob and his wife's physical books and Logos library. It has to keep working for 40+ years, so these rules favor simple, durable choices over clever ones. Created by Jakob Nath.

## Read first, every session

1. This file.
2. `PLAN.md`, the master plan. It is the source of truth. If anything here or in `BUILD_PLAN.md` seems to disagree with it, follow `PLAN.md` and note the conflict in `HOW_IT_WORKS.md` under "Decisions".
3. `CODE_STYLE.md`: how code is written from phase 3 onward. Prototypes are exempt, but no prototype code enters the app or the tools without being rewritten to it.
4. `BUILD_PLAN.md`: find the first unchecked step and continue from there.
5. `DATA_FORMAT.md` and `HOW_IT_WORKS.md`, once they exist.
6. `SAMPLE_BOOKS.md` when you need test data or prototype content.

Then run the self-tests before changing anything.

## Workspace layout

Sessions start in the workspace folder (`My Loci Library/`). It is not a Git repo itself. It holds this file, the plan files, an `inputs/` folder for files Jakob provides (such as a Logos export), and the repos:

- `my-loci-library/`: the app (public, MIT, served by GitHub Pages). Holds a copy of this file, the docs, and the plan files under `docs/plan/`.
- `my-loci-library-tools/`: laptop tools (public, MIT). Holds a copy of this file.
- `my-loci-library-test-data/`: private, sample data used while building.
- `my-loci-library-data/`: private, the real catalog. **Never write to it during the build.** Create it empty with a README in phase 1, then leave it alone.

When you change this file, update the copies in both public repos in the same step.

## How to work

- Work through `BUILD_PLAN.md` in order. Tick each step (`- [x]`) when its check passes, and commit after every step.
- Stop only where `BUILD_PLAN.md` says **STOP**. Everywhere else, keep going.
- If something isn't covered by the plan, choose the lightest option that fits the plan, then record the choice and the reason in `HOW_IT_WORKS.md` under "Decisions". Don't stop to ask.
- If something fails, use the fallback the plan names. If none is named, choose the simplest one, note it under "Decisions", and continue.
- Anything that can only be checked on a real phone goes on `DEVICE_CHECKS.md`, as a short checklist item saying what to try and what should happen. Never wait on it.
- Don't add features that aren't in `PLAN.md`.
- Every step must meet the definition of done in CODE_STYLE.md.

## Hard rules

**Code**

- Plain HTML, CSS and JavaScript (ES modules). No frameworks, no build step, no bundler, no TypeScript, no npm packages, no CDNs.
- Tools run on Node using only built-in modules (`node:fs`, `node:path`, `node:test`, global `fetch`, and so on).
- Third-party code goes only in a `vendor/` folder, each file with its version, license and source URL in `vendor/README.md`. One library is expected (the barcode decoder), and never more than two.
- Use only web features that are "Baseline widely available". Anything newer must sit behind a feature check with a working fallback. No Chromium-only APIs, no push notifications, nothing experimental.
- Size budget: the app's own HTML, CSS and JS stay under about 100 KB, not counting the vendored barcode decoder, which loads only on the scan screen. Heavy work (bulk covers, re-cropping, the HTML catalog, building `catalog.json`) belongs on the laptop, never in the phone app.
- All styling comes from the design tokens file (`styles/tokens.css`). Don't hard-code colors, fonts or spacing elsewhere.
- All GitHub-specific code lives in one sync module. No other file talks to GitHub.
- The app never talks to Zotero, Obsidian, Logos or any AI service. Its only outside calls are the optional Open Library and Google Books lookups, and GitHub through the sync module.
- Tools must run on Windows and Linux: use `node:path` for paths, and ship any launcher as a matching `.cmd` and `.sh` pair.

**Data**

- One pretty-printed JSON file per record, keys always in the same order, UTF-8, newline at the end of the file.
- Record IDs are random, permanent, and never changed or reused.
- Never change the data format without updating `DATA_FORMAT.md`, raising the format version, and keeping older records readable.
- Original dates are never filled in automatically from lookups. Only a person sets them.
- Never commit keys, tokens or personal data. Sync keys live only on each device.

**Tests**

- Run the self-tests before and after every change: the browser test page (`tests/index.html`) in the app repo, and `node --test` in the tools repo.
- Tests are short and plain, so a person can read and fix them without any AI tool.
- Keep the speed targets from `PLAN.md` covered by tests.

## Credits and writing style

- No AI attribution anywhere: no "Co-Authored-By" lines, no "generated with" notes, and no mention of Claude or AI in code, comments, docs or commit messages. Credit goes only to Jakob Nath ("Created by Jakob Nath").
- Commit messages are short and plain, in the imperative ("Add date parser tests").
- Docs and comments read as written by a person for a person: plain sentences, no hype, no emoji, no filler. Write for a reader in 2045 who remembers nothing about this project.
