# My Loci Library tools

Small laptop tools for My Loci Library. Each lives in its own folder and runs on Node (any current version) using only its built-in modules, on Windows and Linux. Every tool is safe to run any number of times.

Created by Jakob Nath.

- `loci-backup/`: the daily backup, the monthly snapshot of the exports and the HTML catalog, and the yearly archive.
- `loci-sizes/`: fills in catalog heights for the shelf view.
- `logos-to-my-loci-library/`: imports a Logos Library spreadsheet export.
- `my-loci-library-to-zotero/`: sends books one way into Zotero.
- `shared/`: what every tool needs (the settings file, reading and writing record files, Git).
- `core/`: a copy of the app's shared core module. Refresh it with `update-core.cmd` (Windows) or `update-core.sh` (Linux), which expect the app repository to sit next to this one.

## Setting up on a laptop

1. Install Git and Node. Clone this repository and the data repository (`my-loci-library-data`) next to each other.
2. Copy `config.example.json` to `config.json` in this folder and fill it in:
   - `dataRepo`: the data repository's folder (relative paths start from this folder).
   - `backupFolder`: the folder that receives the daily copy, such as "My Loci Library backup" inside Google Drive for desktop.
   `config.json` stays on this laptop; it is never committed.
3. Run `loci-backup/loci-backup.cmd` (Windows) or `loci-backup/loci-backup.sh` (Linux) once by hand and read what it reports.

## loci-backup

Each run pulls the data repository, fills catalog heights (`loci-sizes`), rebuilds `catalog.json` (only when a record changed), copies every changed file into `<backupFolder>/data`, saves the exports (CSV, JSON, CSL-JSON, BibTeX and `catalog.html`) once a month in `<backupFolder>/snapshots/<year-month>`, records the backup in `backup-status.json`, and commits and pushes what it changed in one commit. Files are never deleted from the backup folder.

`catalog.html` opens in any browser with no internet: every book with its cover thumbnail, and a search box. It is the backup a person can read without the app.

Options: `--no-git` (work on the files only), `--no-sizes` (skip the catalog heights).

### Running it every day

Windows (Task Scheduler):
1. Open Task Scheduler › Create Basic Task. Name: "My Loci Library backup". Trigger: Daily, at a time the laptop is usually on (such as 12:30).
2. Action: Start a program. Program: the full path of `loci-backup\loci-backup.cmd`. Start in: the `loci-backup` folder.
3. In the task's properties, tick "Run task as soon as possible after a scheduled start is missed", so a day the laptop was off is caught up.

Linux (cron): run `crontab -e` and add a line such as

    30 12 * * * /home/jakob/my-loci-library-tools/loci-backup/loci-backup.sh >> /home/jakob/loci-backup.log 2>&1

### The yearly archive

Once a year the app reminds you (in Settings, and once a week on opening) to save a full archive to an external drive. Plug in the drive and run

    loci-backup\loci-backup.cmd --archive "E:\Loci archive"        (Windows)
    loci-backup/loci-backup.sh --archive /media/drive/loci-archive   (Linux)

It writes a dated folder with every record and picture, the exports, and the whole history as one Git bundle (`history.bundle`, restored with `git clone history.bundle my-loci-library-data`), and resets the reminder.

## loci-sizes

Fills in the height of every physical book that has an ISBN and no height, from the Library of Congress catalog (the height printed in the book's record, to the whole centimeter). A height typed in the app is never changed. Books the catalog does not know are asked about again after 90 days; that list is kept in `loci-sizes/checked.json` on this laptop. It runs with every backup, and by hand with `loci-sizes.cmd` or `loci-sizes.sh`. Options: `--limit 200` (ask about at most that many books this time), `--no-git`.

If the Library of Congress service ever changes or disappears, nothing else depends on it: sizes simply stay estimated in the app.

## logos-to-my-loci-library

Brings a Logos Library export into the catalog. In Logos, open the Library, filter it if you like (for example, resources added in the last 7 days), and use Print/Export to save a spreadsheet (CSV). Then run

    logos-to-my-loci-library\logos-import.cmd "C:\Users\me\Downloads\Library.csv"          (Windows)
    logos-to-my-loci-library/logos-import.sh ~/Downloads/Library.csv                  (Linux)

Rows are matched to books by their Logos resource ID. A new resource becomes a work, an edition (format Logos) and a copy; its authors are matched to authors already in the catalog by any form of their name. On later runs a field is updated only if it still holds what the importer last wrote there, so anything edited in the app is kept. What the importer last wrote is kept in `integrations/logos-import.json` in the data repository. Original dates are never filled in.

- Add `--full` when the export lists the whole Logos library, unfiltered: resources missing from it are then marked "gone from Logos" (and marked owned again if they come back). A filtered export never removes anything.
- Possible links to works already in the catalog (a Logos copy of a book we also own in print) are written to `links-to-confirm.txt` in the tool's folder. Change "no" to "yes" on each right line and run the tool with `--confirm-links`.
- `--covers 200` fetches up to 200 covers, by ISBN, from Open Library into `images/inbox/` of the data repository; run it again to carry on. Then open `laptop/covers.html` (in the app, in the same browser as the app on this laptop) and choose the inbox files; the app sends the covers with its next sync. Books without an ISBN or an Open Library cover keep the drawn cover the app makes from their title and author.

Which column fills which field (`columns.mjs`; every other column is kept as it came in the edition's "extra Logos data"):

| Field | Logos column (any of) |
| --- | --- |
| Logos resource ID | Resource ID, ResourceId, Resource Id, Resource |
| Title | Title |
| Subtitle | Subtitle |
| Authors | Author, Authors, Creator, Creators ("Surname, Given" names, separated by ";") |
| Publisher | Publisher |
| Year | Publication Date, Date, Year, Published |
| Series | Series |
| Languages | Language, Languages |
| ISBN | ISBN |

These names are a first reading, made before a real export was at hand. When the first real export is imported, check its column names against this table and add any that differ to `columns.mjs`.

## my-loci-library-to-zotero

Sends the catalog one way into a "My Loci Library" collection in Zotero: every physical book, Logos books marked "cite" in the app, and, for an anthology, a book section for each work in it (related to the anthology's item), so one piece can be cited. Wishlist items never go.

Each item gets the original date and its pinned Better BibTeX citation key in Extra ("Original Date: 397", "Citation Key: Augustine1991"), the shelf location in "Loc. in Archive", and the book's permanent Loci link as its URL. Keys follow the pattern Better BibTeX already uses (first author's surname and the edition's year, with a, b, c for repeats), and once given a key never changes. Nothing is ever deleted from Zotero: a book no longer owned is tagged "Loci: no longer owned", and one removed from Loci (or a Logos book no longer marked "cite") "Loci: removed". Only books that changed since the last run are sent. Which Loci record is which Zotero item is kept in `integrations/zotero-links.json` in the data repository.

Setting up, once:
1. At zotero.org/settings/keys, note "Your userID for use in API calls", and make a new private key with "Allow library access" and "Allow write access".
2. Put both in `config.json` as `zoteroUserId` and `zoteroKey`. The key stays on this laptop.
3. Try it on a test collection first: `loci-zotero.cmd --collection "Loci test"`. Look at the items in Zotero, then delete that collection and its items in Zotero by hand, and delete `integrations/zotero-links.json` in the data repository before the real first run.

Then run `my-loci-library-to-zotero\loci-zotero.cmd` (Windows) or `my-loci-library-to-zotero/loci-zotero.sh` (Linux) whenever you mark a book to cite; it finishes in a few seconds, and Zotero on the laptop shows the book after its next sync (usually within seconds; Edit › Settings › Sync › "Sync automatically" must be on). To run it on a schedule too, make a Task Scheduler task as for loci-backup, repeating every hour.

On the first run, books already in Zotero (matched by ISBN, or by title and year) are linked instead of being added again. Their data is replaced by Loci's, but their notes, attachments, other tags, other collections, other lines in Extra and any pinned citation key are kept; every field that was overwritten is listed in the run's report.

Zotero 7's local connection on the laptop can only read, so the tool writes through Zotero's web API, which the plan names as the fallback.

## Tests

Run `node --test` in this folder. It runs every tool's tests (with temporary folders and recorded answers, never the real data or the network), the shared core's tests, and checks that `core/` here matches `core/` in the app repository. Never edit `core/` here: edit it in the app repository, then run `update-core.cmd` (Windows) or `update-core.sh` (Linux).

## License

MIT. See `LICENSE`.
