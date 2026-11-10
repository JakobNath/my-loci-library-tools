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

## Tests

Run `node --test` in this folder. It runs every tool's tests (with temporary folders and recorded answers, never the real data or the network), the shared core's tests, and checks that `core/` here matches `core/` in the app repository. Never edit `core/` here: edit it in the app repository, then run `update-core.cmd` (Windows) or `update-core.sh` (Linux).

## License

MIT. See `LICENSE`.
