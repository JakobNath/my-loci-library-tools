# How code is written in My Loci Library

This project has to stay readable and repairable for 10+ years by someone who may have been away from programming for a long time, with whatever tools exist then. That reader might be Jakob, a colleague, or an AI we can't predict. Every rule below serves one test:

> **Could someone who knows basic JavaScript, and nothing else about this project, open any one file, understand it in five minutes, and change it safely, with the tests telling them if they broke something?**

When a rule here seems to conflict with that test, the test wins. Record the exception in `docs/decisions/` (in the app).

These rules apply from phase 3 onward. Prototypes are throwaway and exempt, but **no prototype code enters the app or the tools without being rewritten to these rules**. This includes the photo detection and enhancement code.

---

## 1. What "lightweight" means here

Weight is everything a future reader must know, trust or keep running for the code to work. In order of how much it costs over ten years:

1. **Outside dependencies:** libraries, build tools, services. They change and disappear. That's why there are none except the vendored barcode decoder.
2. **Concepts:** every pattern, convention or abstraction the reader must learn before reading the code.
3. **Indirection:** every layer between "where it's called" and "where it happens".
4. **Hidden behavior:** anything that works because of a convention, global state or a file somewhere else.
5. **Process:** any step needed to run, test or deploy. Here: open the page, or run `node --test`. Nothing else.

Small code size is a side effect, not the goal. A longer, plain function beats a short, clever one.

---

## 2. Architecture: one rule, no ceremony

From *Clean Architecture* we keep the **dependency rule** and **single responsibility**. We deliberately skip the rest of the ceremony (interface layers, dependency-injection containers, use-case classes, presenters), because for a two-person app it adds more weight than it removes.

### The three rings

```
core/        Pure rules of the library. No browser, no Node, no network, no storage.
             Imports only other core files.

edges/       One small module per outside thing. Each talks to exactly one outside
             system and nothing else.

ui/ + main   Screens. They call core for rules and edges for the outside world.
             main.js wires it all together.
```

**Dependencies point inward only.** `ui` may import `edges` and `core`. `edges` may import `core`. `core` imports nothing outside `core`. A test enforces this (see section 8).

### The edge modules (app)

| Module | Talks to | Nothing else may |
| --- | --- | --- |
| `edges/storage.js` | IndexedDB | touch IndexedDB |
| `edges/sync-github.js` | GitHub API | call GitHub |
| `edges/lookup-openlibrary.js` | Open Library | call Open Library |
| `edges/lookup-googlebooks.js` | Google Books | call Google Books |
| `edges/camera.js` | camera, barcode decoder | use `getUserMedia` or the decoder |
| `edges/photo.js` | canvas (detect, straighten, enhance, compress) | use canvas for photos |
| `edges/device.js` | settings stored on this device | read device settings directly |

Tools follow the same shape: `core/` (the shared copy), and per tool an `edges/` for the outside system it touches (Logos CSV files, Zotero, the file system) plus a thin `main.js`.

**Why this matters for this project:** in ten years GitHub's API, iOS camera rules, and Zotero will each have changed at least once. Each change should mean rewriting one edge file, with core and screens untouched.

### Dependency inversion, the plain way

Don't create interfaces or classes for it. Pass functions. A screen that needs to save receives `save` from `main.js`. A core function that needs "today" takes the date as an argument instead of reading the clock. Core functions never reach out; things are handed to them.

---

## 3. Core: pure, plain, total

- **Pure functions only.** Same input, same output, no side effects. No `Date.now()`, no `Math.random()`, no I/O inside core. Pass those values in.
- **Plain data only.** Records are plain JSON objects, exactly as stored on disk. No classes, no prototypes, no methods on records. What's in memory is what's in the file.
- **Never mutate inputs.** Return new objects.
- **Total functions.** Handle every input the data format allows. If input is invalid, return a clear result (validation returns a list of problems) or throw an `Error` whose message says what was wrong and what was expected.
- **Format changes go through migrations.** When the data format version rises, core gets a function `migrate(record)` that upgrades old records one version at a time, with tests for each step. Old records are never silently reinterpreted.

---

## 4. One vocabulary everywhere

Use the same words in the data, the code, the UI and the docs. They are defined once in `DATA_FORMAT.md`:

> work, edition, copy, author, contents (of an anthology), dating, working dating, sort year, earliest, latest, certainty, location, binding, series, set, wishlist item, status, value, value history, cover, spine, thumbnail, detail image, cover inbox

- Never invent synonyms (`book`, `item`, `entry`, `volume`) for these in code. "Book" is fine in UI text, where it means what a person means.
- Names say what something **is**: `sortYear`, `parseDating`, `editionsOfWork`. Not `data`, `info`, `handle`, `process`, `util`, `manager`, `helper`.
- Booleans read as yes/no questions: `isDigital`, `hasMarkings`.
- Functions are verbs, values are nouns. No abbreviations beyond common ones (`id`, `isbn`, `url`).

---

## 5. Files and functions

- **One responsibility per file**, stated in a header comment of 1–3 lines: what this file is for, and which outside system it touches, if any.
- **Short.** As a guideline, functions under about 40 lines and files under about 300. Split by responsibility, not by line count: a 60-line function that reads top to bottom is better than four 15-line functions that bounce between each other.
- **Flat and searchable.** Shallow folders. Searching the project for a word in the UI or a field name should land on the code that handles it. No string-built property names, no dynamic imports except loading the camera and photo code on demand.
- **No metaprogramming, no generated code, no global variables** (one exception: `main.js` holds the app's top-level state, and it says so).
- **One way to do each thing.** Before writing a helper, search for an existing one. If a pattern exists, follow it, even if you would have chosen differently.
- **Don't abstract early.** Write it plainly the first time. Write it again the second time. Extract a shared function only when the third use proves what is actually shared.

---

## 6. The user interface without a framework

The usual failure of framework-free code is accidentally building a worse framework. Avoid that with one deliberately simple pattern, used everywhere:

- Each screen is one file exporting `render(container, state, actions)`. It builds the screen's HTML, puts it in the container, and wires events (one delegated listener per screen, using `data-action` attributes).
- State changes go through `actions` from `main.js`, which updates state and calls `render` again for the affected screen. No two-way binding, no observers, no virtual DOM.
- **Long lists are the one exception:** the library grid draws only visible rows, in one clearly named module.
- **Escape all text from data before it goes into HTML**, using the single `escapeHtml` helper. Titles, notes and anything from a lookup are data, never markup. This is a security rule, not a style preference.
- All look and feel comes from `styles/tokens.css`. Screens use token variables, never raw colors, fonts or sizes.

---

## 7. Errors and the outside world

- **Never fail silently.** No empty `catch` blocks. No fallbacks that hide a problem without telling anyone.
- **Edges translate failures into plain messages** a person can act on: "Your sync key has expired. Here's how to make a new one." Not "Error 401".
- **Feature checks live in the edge that needs them,** each with a working fallback and a comment naming the feature and why it's checked.
- **Check inputs at the edges, trust them in core.** Data from lookups, files, cameras or users is validated once, at the edge where it enters.
- **Don't scatter defensive checks.** One validation at the boundary beats a null check in every function.

---

## 8. Tests are the specification

- Every core function has tests. Test names are sentences that state the rule: `"early 2nd century gives 101 to 133"`, `"a disputed work sorts by its working dating"`.
- **Tests use the sample books** from `SAMPLE_BOOKS.md` wherever possible, so the specification is written in real cases.
- **No mocking libraries.** Edges are tested with small hand-written fakes, or real browser APIs where they work in a test page.
- **Architecture tests**, which are short scans of the source files:
  - `core/` imports nothing outside `core/` and uses no browser or Node globals.
  - Only `edges/sync-github.js` mentions `api.github.com`, and only each lookup edge mentions its service.
  - No file outside `edges/storage.js` uses `indexedDB`.
  - Every `innerHTML` assignment uses `escapeHtml` for data.
  - The app's own files stay within the size budget.
- **Speed targets from `PLAN.md` are tests**, not hopes.
- A failing test is never deleted or weakened to make a change pass. Either the change is wrong, or the rule changed and `PLAN.md` says so.

---

## 9. Comments and decisions

- **Comments explain why, never what.** The code says what. Example: `// BC years are negative so sorting works across the era boundary.`
- Every non-obvious number gets a comment with its reason: `600 // detail cover height in px, chosen in the photo prototype round 2`.
- Exported core functions get a short JSDoc block (purpose, parameters, return value). It gives types and hints to any editor, with no build step. Nothing more elaborate.
- **Decisions go in `docs/decisions/`** (in the app), at the end of the file for their topic: date, what was decided, what was rejected, and why. One short paragraph each. In ten years, *why* is worth more than *what*.
- No commented-out code, no `TODO` without a matching item in `BUILD_PLAN.md` or `DEVICE_CHECKS.md`, no dead code. Git remembers deleted code.

---

## 10. Formatting

There is no formatter tool (it would be an npm dependency), so the rules are short and followed by hand:

- 2-space indents, semicolons, single quotes, trailing commas in multi-line lists.
- `const` by default, `let` when reassigned, never `var`. Always `===`.
- `async`/`await` rather than `.then` chains.
- ES modules with explicit `.js` extensions in imports.
- Lines under about 100 characters.

---

## 11. Writing code with an AI, and against its habits

Code written by AI tends to drift in predictable ways. Watch for and avoid:

- **Over-abstraction:** factories, wrappers and "flexible" options nobody asked for.
- **Narrating comments** that restate the code line by line.
- **Defensive clutter:** null checks and try/catch everywhere instead of validating once at the edge.
- **Reinvented helpers:** a new date or escape function written when one already exists. Search first.
- **Silent fallbacks** that swallow errors to make something "work".
- **Inconsistent names** for the same thing across files.
- **Big-bang changes:** prefer small steps, each one leaving all tests passing.

The goal is code that reads as if one careful person wrote it, in one consistent voice.

---

## 12. Definition of done (every step)

- [ ] Follows the three rings; architecture tests pass.
- [ ] All tests pass in the browser test page and `node --test`.
- [ ] Uses the vocabulary in `DATA_FORMAT.md`; no new synonyms.
- [ ] Every file has its header comment; comments explain why.
- [ ] No new dependency, global, or abstraction without a recorded decision.
- [ ] Any data format change has a migration, a test, and an updated `DATA_FORMAT.md`.
- [ ] The five-minute test: a newcomer could understand and safely change what was just written.
