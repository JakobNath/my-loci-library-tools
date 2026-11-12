# My Loci Library tools

Small laptop tools for My Loci Library. Each lives in its own folder and runs on Node (any current version) using only its built-in modules, on Windows and Linux. Every tool is safe to run any number of times.

Created by Jakob Nath.

- `loci-backup/`: the daily backup, the monthly snapshot of the exports and the HTML catalog, and the yearly archive.
- `loci-enrich/`: fills empty book fields (pages, sizes, edition, series, translators and more) from the Library of Congress, Open Library and Google Books.
- `logos-to-my-loci-library/`: imports a Logos Library spreadsheet export.
- `my-loci-library-to-zotero/`: sends books one way into Zotero.
- `shared/`: what every tool needs (the settings file, reading and writing record files, Git).
- `core/`: a copy of the app's shared core module. Refresh it with `update-core.cmd` (Windows) or `update-core.sh` (Linux), which expect the app repository to sit next to this one.

## Setting up on a laptop

1. Install Git and Node. Clone this repository and the data repository (`my-loci-library-data`) next to each other.
2. Copy `config.example.json` to `config.json` in this folder and fill it in:
   - `dataRepo`: the data repository's folder (relative paths start from this folder).
   - `backupFolder`: the folder that receives the daily copy, such as "My Loci Library backup" inside Google Drive for desktop. Set Drive for desktop to mirror My Drive (Settings › Preferences › Folders from Drive › Mirror files), so the folder is an ordinary one on the laptop, such as `C:/Users/Jakob/My Drive/My Loci Library backup`; a streamed drive (`G:`) is missing whenever Drive for desktop is not running, and the backup would fail.
   - `googleBooksKey` (optional): a free Google Books key, so the tools can ask Google Books too (see "A Google Books key" below).
   `config.json` stays on this laptop; it is never committed.
3. Run `loci-backup/loci-backup.cmd` (Windows) or `loci-backup/loci-backup.sh` (Linux) once by hand and read what it reports.

## A Google Books key

Google Books refuses most requests without a key. One free key, made once, serves the laptop and every phone (each phone pastes it in Settings › Advanced, which has the same steps and a "Test the key" button). It takes about two minutes:

1. Open https://console.cloud.google.com/apis/library/books.googleapis.com and sign in with any Google account. If it asks for a project, make one (any name, such as "My Loci Library"). Click **Enable**.
2. Open https://console.cloud.google.com/apis/credentials, click **Create credentials**, then **API key**.
3. In the form that opens (or, if a key appears at once, by clicking its name), choose **Restrict key** under **API restrictions** and tick **Books API**, so the key is good for nothing else. Leave **Application restrictions** at **None**. Click **Create** or **Save**, and copy the key (it starts with `AIza`).
4. Put it in `config.json` as `"googleBooksKey": "AIza..."`. It stays on this laptop and is never committed.

## loci-backup

Each run pulls the data repository, fills empty book fields (`loci-enrich`), rebuilds `catalog.json` (only when a record changed), copies every changed file into `<backupFolder>/data`, saves the exports (CSV, JSON, CSL-JSON, BibTeX and `catalog.html`) once a month in `<backupFolder>/snapshots/<year-month>`, records the backup in `backup-status.json`, and commits and pushes what it changed in one commit. Files are never deleted from the backup folder.

`catalog.html` opens in any browser with no internet: every book with its cover thumbnail, and a search box. It is the backup a person can read without the app.

Options: `--no-git` (work on the files only), `--no-enrich` (skip filling book fields).

### Running it every day

Windows (Task Scheduler):
1. Open Task Scheduler › Create Basic Task. Name: "My Loci Library backup". Trigger: Daily, at a time the laptop is usually on (such as 12:30).
2. Action: Start a program. Program: the full path of `loci-backup\loci-backup.cmd`. Start in: the `loci-backup` folder.
3. In the task's properties, tick "Run task as soon as possible after a scheduled start is missed", so a day the laptop was off is caught up.

Or make the same task in one step from PowerShell (change the folder to where the tools are):

    $folder = 'C:\path\to\my-loci-library-tools\loci-backup'
    Register-ScheduledTask -TaskName 'My Loci Library backup' -Action (New-ScheduledTaskAction -Execute "$folder\loci-backup.cmd" -WorkingDirectory $folder) -Trigger (New-ScheduledTaskTrigger -Daily -At '12:30') -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1))

Task Scheduler's "Last Run Result" should read 0 (success) after a run.

Linux (cron): run `crontab -e` and add a line such as

    30 12 * * * /home/jakob/my-loci-library-tools/loci-backup/loci-backup.sh >> /home/jakob/loci-backup.log 2>&1

### The yearly archive

Once a year the app reminds you (in Settings, and once a week on opening) to save a full archive to an external drive. Plug in the drive and run

    loci-backup\loci-backup.cmd --archive "E:\Loci archive"        (Windows)
    loci-backup/loci-backup.sh --archive /media/drive/loci-archive   (Linux)

It writes a dated folder with every record and picture, the exports, and the whole history as one Git bundle (`history.bundle`, restored with `git clone history.bundle my-loci-library-data`), and resets the reminder.

## loci-enrich

Fills the **empty** fields of every book with an ISBN from the Library of Congress, then Open Library, then Google Books (with `googleBooksKey` in `config.json`; without one Google Books is not asked): pages as printed, height and thickness, edition, series and number, place, translators and editors (when the book names none yet), and, for a book holding one work, the work's original title and language. When sources disagree, the Library of Congress wins for bibliographic facts; a value is taken only from a record that lists the book's own ISBN. It never fills an original date. The contents of an anthology are only listed in its report, to be entered by hand if they are right, and never for a Bible.

It keeps what it wrote for each book in the data repository (`integrations/enrich.json`), and never touches a field again once it has written it, so a value a person changed or cleared stays as they left it. Each book is asked about once, and again after 90 days (so new catalog records are found); a first run on a large catalog carries on where it stopped. It pauses a second between books, to be gentle on the free services, writes its report to the screen and to `loci-enrich/last-report.txt`, and commits once.

It runs with every backup, and by hand with `loci-enrich.cmd` or `loci-enrich.sh`. Options: `--limit 200` (ask about at most that many books this time), `--no-git`.

Every request names the tools (`IDENTITY` in `loci-enrich/sources.mjs`), as Open Library and Wikimedia ask, and the sources' addresses are kept together there (`ADDRESSES`), so a source that moves is changed in one place. A source that refuses a request ("too many requests", or refused outright) is not asked again for the rest of that run, and the report says so; its books are asked again next time. The sources, their limits and terms are described in the app's `SOURCES.md`.

**Checking the sources.** `check-sources.cmd` (or `check-sources.sh`, or `node loci-enrich/check-sources.mjs`) asks each source live about the books whose answers are recorded for the tests (`core/tests/answers/`), reads both with the same code, and lists any source that no longer answers or any field that now reads differently. A difference is not always a fault (a catalog record may have been corrected), but it is where to look first when lookups seem wrong. Run it in the yearly check, or whenever a source seems to have changed. It changes nothing.

Adding a book on the phone asks only what a person knows; the details above are left to this tool. Run it by hand right after a scanning session, rather than waiting for the night's backup, and the app's "Needs details" filter (in the Library, with a count in Settings) then shows what it could not find.

The Library of Congress service has no encrypted connection and does not allow calls from web pages, which is why only this laptop tool asks it. If any source ever changes or disappears, nothing else depends on it: those fields simply stay as they are.

## logos-to-my-loci-library

Brings a Logos Library export into the catalog. In Logos, export a collection (or the whole Library) as a CSV spreadsheet; in 2026 this was done from the Collections menu. Then run

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

Sends the catalog one way into a "My Loci Library" collection in Zotero: every physical book, Logos books marked "cite" in the app, and, for an anthology, a book section for each work in it (related to the anthology's item), so one piece can be cited. Bibles are the exception: scripture is cited by book, chapter and verse, so a Bible (NA28, BHS, a study Bible) is sent as one book. A book counts as a Bible when its category is "Bibles", Logos calls it a Bible, or at least half of its works are books of the Bible. Wishlist items never go.

Each item carries only bibliographic data, so citations stay exact: the original date goes in Zotero's own Original Date field ("397", or "385 BC"), and the pinned citation key in its own Citation Key field. URL, Loc. in Archive and Extra are left alone, because Chicago prints the first two in citations and Better BibTeX may export Extra lines as a note. Under each book (not under sections) is one attached link, "My Loci Library · Home › Office › Case 1", which opens the book in Loci and is renamed whenever its shelf changes. Keys follow the pattern Better BibTeX already uses (first author's surname and the edition's year, with a, b, c for repeats), and once given a key never changes. Nothing is ever deleted from Zotero: a book no longer owned is tagged "Loci: no longer owned", and one removed from Loci (or a Logos book no longer marked "cite") "Loci: removed". Only books that changed since the last run are sent. Which Loci record is which Zotero item is kept in `integrations/zotero-links.json` in the data repository.

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
