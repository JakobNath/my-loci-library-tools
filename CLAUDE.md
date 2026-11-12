# My Loci Library: project rules

My Loci Library is a lightweight, open-source catalog of Jakob and his wife's physical books and Logos library. It has to keep working for 40+ years, so these rules favor simple, durable choices over clever ones. Created by Jakob Nath.

This file is kept identical in the app (`my-loci-library`) and the laptop tools (`my-loci-library-tools`). When you change one, change the other in the same step.

## Where things are

- `docs/plan/STATUS.md` (in the app): where the project stands and what comes next.
- `docs/plan/PLAN.md` (in the app): the master plan and the source of truth. If anything disagrees with it, follow PLAN.md and record the conflict as a decision.
- `docs/decisions/` (in the app): every choice the plan did not settle, with its reason, one file per topic.
- `CODE_STYLE.md`: how code is written, and the definition of done.
- `DATA_FORMAT.md` (in the app): every field of a record.
- `HOW_IT_WORKS.md` (in the app): the parts and how to fix each one.
- The tools' `README.md`: each laptop tool and how to run it.

The real catalog lives in a private repository, `my-loci-library-data`; sample data for building and testing lives in `my-loci-library-test-data`. Never write to the real catalog while building or testing.

## How to work

- If something is not covered by the plan, choose the lightest option that fits the plan, then record the choice and the reason at the end of the right file in `docs/decisions/`.
- If something fails, use the fallback the plan names. If none is named, choose the simplest one and record it.
- Anything that can only be checked on a real phone goes on `DEVICE_CHECKS.md`, as a short checklist item saying what to try and what should happen.
- Don't add features that aren't in `PLAN.md`.
- Every change must meet the definition of done in `CODE_STYLE.md`.

## Hard rules

**Code**

- Plain HTML, CSS and JavaScript (ES modules). No frameworks, no build step, no bundler, no TypeScript, no npm packages, no CDNs.
- Tools run on Node using only built-in modules (`node:fs`, `node:path`, `node:test`, global `fetch`, and so on).
- Third-party code goes only in a `vendor/` folder, each file with its version, license and source URL in `vendor/README.md`. One library is expected (the barcode decoder), and never more than two.
- Use only web features that are "Baseline widely available". Anything newer must sit behind a feature check with a working fallback. No Chromium-only APIs, no push notifications, nothing experimental.
- Size budget: the app's own HTML, CSS and JS stay under about 100 KB, not counting the vendored barcode decoder, which loads only on the scan screen. Heavy work (bulk covers, re-cropping, the HTML catalog, building `catalog.json`) belongs on the laptop, never in the phone app.
- All styling comes from the design tokens file (`styles/tokens.css`). Don't hard-code colors, fonts or spacing elsewhere.
- All GitHub-specific code lives in one sync module. No other file talks to GitHub.
- The app never talks to Zotero, Obsidian, Logos or any AI service. Its only outside calls are the optional Open Library, Google Books, HathiTrust and Wikidata lookups, and GitHub through the sync module. Each lookup is optional, identifies the app, backs off when refused, and never stops a book being entered by hand (`SOURCES.md`).
- Tools must run on Windows and Linux: use `node:path` for paths, and ship any launcher as a matching `.cmd` and `.sh` pair.

**Data**

- One pretty-printed JSON file per record, keys always in the same order, UTF-8, newline at the end of the file.
- Record IDs are random, permanent, and never changed or reused.
- Never change the data format without updating `DATA_FORMAT.md`, raising the format version, and keeping older records readable.
- Original dates are set by a person: typed, chosen, or confirmed with one tap from a suggestion or a checked known-set list. They are never saved from a lookup without that.
- Never commit keys, tokens or personal data. Sync keys live only on our devices and in the setup links we send each other; never in a repository or in the app's code.

**Tests**

- Run the self-tests before and after every change: the browser test page (`tests/index.html`) and `node --test` in the app repo (the same core tests, plus the architecture checks), and `node --test` in the tools repo.
- Tests are short and plain, so a person can read and fix them without any AI tool.
- Keep the speed targets from `PLAN.md` covered by tests.

## Credits and writing style

- No AI attribution anywhere: no "Co-Authored-By" lines, no "generated with" notes, and no mention of Claude or AI in code, comments, docs or commit messages. Credit goes only to Jakob Nath ("Created by Jakob Nath").
- Commit messages are short and plain, in the imperative ("Add date parser tests").
- Docs and comments read as written by a person for a person: plain sentences, no hype, no emoji, no filler. Write for a reader in 2045 who remembers nothing about this project.
