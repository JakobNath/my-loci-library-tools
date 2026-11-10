// The value view's totals and the exports (BUILD_PLAN.md phase 9), with the sample books.

import { newRecord } from '../records.js';
import { buildLibrary } from '../library.js';
import { valueSummary } from '../value.js';
import { catalogCsv, valueCsv, catalogJson, cslJson, bibtex } from '../exports.js';
import { valueHistoryWithout } from '../entry.js';
import { archiveReminder, lastBackupLine } from '../backup-status.js';
import { equal, same, ok } from './check.js';
import { na28, na28Works, loeb36, loebWorks, plato, augustine, confessions, chadwick, edition } from './samples.js';

const NOW = '2026-11-10T12:00:00Z';
const copy = (id, edition, values) => newRecord('copy', id, NOW, { edition, added: '2026-11-10', ...values });
const logos = newRecord('edition', 'l0g0sed1t10n', NOW, { title: 'Confessions (Logos)', contents: [{ work: confessions.id, extent: 'complete', translator: null, pages: null }], medium: 'logos' });
const records = [...na28Works, na28, ...loebWorks, loeb36, plato, augustine, confessions, chadwick, logos,
  copy('c0py0000000g', na28.id, { location: ['Home', 'Office', 'Case 1'], value: 60 }),
  copy('c0py0000000h', loeb36.id, { location: ['Home', 'Office', 'Case 2'], value: 28.5 }),
  copy('c0py0000000j', chadwick.id, { location: ['Home', 'Bedroom'], value: null, notes: 'Gift, with "inscription", 2019' }),
  copy('c0py0000000k', chadwick.id, { location: ['Home', 'Bedroom'], value: 15, status: 'given away' }),
  copy('c0py0000000m', logos.id, { value: 30 })];
const library = buildLibrary(records);

export const tests = [
  {
    name: 'value totals: owned physical copies only, by room, with books lacking a value counted and Logos kept apart',
    fn() {
      const summary = valueSummary(library.entries);
      equal(summary.total, 88.5);
      equal(summary.count, 3, 'the given-away copy is left out');
      equal(summary.missing, 1);
      same(summary.byPlace.map(row => [row.place, row.total, row.missing]), [['Home › Office', 88.5, 0], ['Home › Bedroom', 0, 1]]);
      equal(summary.logosTotal, 30);
      equal(summary.logosCount, 1);
    },
  },
  {
    name: 'value history: an entry can be deleted, and the rest is kept in order',
    fn() {
      const history = [{ date: '2026-01-02', value: 40 }, { date: '2026-05-01', value: 45 }, { date: '2026-11-10', value: 50 }];
      same(valueHistoryWithout(history, ['2026-05-01']), [{ date: '2026-01-02', value: 40 }, { date: '2026-11-10', value: 50 }]);
    },
  },
  {
    name: 'CSV keeps titles, authors, editions and original dates, and quotes commas and quotation marks',
    fn() {
      const text = catalogCsv(library.entries);
      const lines = text.trim().split('\r\n');
      ok(lines[0].startsWith('Title,Subtitle,Authors,Original date'));
      const confessionsLine = lines.find(line => line.includes('Gift'));
      ok(confessionsLine.startsWith('Confessions,'), 'the title');
      ok(confessionsLine.includes('Augustine'), 'the author');
      ok(confessionsLine.includes('c. 397–400'), 'the original date as written');
      ok(confessionsLine.includes('"Gift, with ""inscription"", 2019"'), 'a note with a comma and quotes stays one cell');
      ok(lines.some(line => line.startsWith('Euthyphro. Apology. Crito. Phaedo. Phaedrus.,')), 'an anthology');
      ok(valueCsv(library.entries).includes('Total,,,,,,88.5'), 'the insurance CSV ends with the total');
      ok(!valueCsv(library.entries).includes('Logos'), 'Logos books are left out of the insurance list');
    },
  },
  {
    name: 'JSON holds every record; CSL-JSON and BibTeX carry the original date',
    fn() {
      const json = JSON.parse(catalogJson(records, NOW));
      equal(json.copies.length, 5);
      equal(json.editions.length, 4);
      const csl = JSON.parse(cslJson(library.entries, library.worksById, library.authorsById));
      const item = csl.find(entry => entry.id === chadwick.id);
      same(item['original-date'], { 'date-parts': [[397]] });
      const bib = bibtex(library.entries, library.worksById, library.authorsById);
      ok(bib.includes('@book{Augustine1991,'), 'keys are author and year, as Better BibTeX makes them in Zotero');
      ok(bib.includes('@book{Novum2012,'), 'or the first word of the title when there is no author');
      ok(bib.includes('origdate = {0397}'));
      ok(!bib.split('@book{Plato1914,')[1].split('@book')[0].includes('origdate'), 'a collection has no original date of its own');
      const phaedo = edition('ph2d0s1ngle0', 'Phaedo', [loebWorks[0].id], { year: 1914 });
      const single = buildLibrary([...loebWorks, phaedo, plato]);
      ok(bibtex(single.entries, single.worksById, single.authorsById).includes('origdate = {-0398}'), '399 BC, counted as biblatex does');
      ok(bib.includes('title = {Confessions}'));
      equal((bib.match(/@book\{/g) || []).length, library.entries.length, 'one entry per edition');
      equal(new Set(bib.match(/@book\{[^,]+/g)).size, library.entries.length, 'keys are unique');
    },
  },
  {
    name: 'the yearly archive reminder appears a year after the last archive (or the first backup), not before',
    fn() {
      const status = { format: 1, firstBackup: '2026-11-10T03:00:00Z', lastMirror: '2027-03-01T03:00:00Z', lastSnapshot: '2027-03', lastArchive: null };
      equal(archiveReminder(status, '2027-11-09'), null, 'one day short of a year');
      ok(archiveReminder(status, '2027-11-10'), 'a year after the first backup, with no archive yet');
      equal(archiveReminder({ ...status, lastArchive: '2027-11-12T10:00:00Z' }, '2028-06-01'), null, 'an archive resets it');
      ok(archiveReminder({ ...status, lastArchive: '2027-11-12T10:00:00Z' }, '2028-11-12'));
      equal(archiveReminder(null, '2030-01-01'), null, 'no laptop backup yet: no reminder');
      equal(lastBackupLine(status), 'Last backup to the backup folder: 2027-03-01.');
    },
  },
];
