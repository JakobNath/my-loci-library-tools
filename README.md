# My Loci Library tools

Small laptop tools for My Loci Library. Each lives in its own folder and runs on Node using only its built-in modules, on Windows and Linux. Every tool is safe to run any number of times.

Created by Jakob Nath.

- `logos-to-my-loci-library/`: imports a Logos Library spreadsheet export.
- `my-loci-library-to-zotero/`: sends books one way into Zotero.
- `loci-backup/`: daily mirror and monthly export snapshot.
- `core/`: a copy of the app's shared core module. Refresh it with `update-core.cmd` (Windows) or `update-core.sh` (Linux), which expect the app repository to sit next to this one.

## Tests

Run `node --test` in this folder.

## License

MIT. See `LICENSE`.
