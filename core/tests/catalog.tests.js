// Anthology date ranges, page counts, sizes and search, with the sample books.

import { anthologyRange } from '../anthology.js';
import { countPages } from '../pages.js';
import { estimateSize } from '../sizes.js';
import { normalizeForSearch, searchTextOf, matchesSearch } from '../search.js';
import { parseContentsLines, contentsLine } from '../contents.js';
import { buildLibrary, viewEntries, searchEntries, authorLineOf } from '../library.js';
import { equal, same, ok } from './check.js';
import { na28, na28Works, triglotta, triglottaWorks, loeb36, loebWorks, plato, augustine, confessions, chadwick, work, edition, byId } from './samples.js';

export const tests = [
  {
    name: 'NA28 (#6) spans c. 57 to c. 95, and 2 Peter counts by its working dating',
    fn() {
      same(anthologyRange(na28, byId(na28Works)), { earliest: 57, latest: 95, count: 5, missing: [] });
    },
  },
  {
    name: 'the Concordia Triglotta (#8) spans the 4th century to 1577',
    fn() {
      const range = anthologyRange(triglotta, byId(triglottaWorks));
      equal(range.earliest, 325);
      equal(range.latest, 1577);
    },
  },
  {
    name: 'Loeb 36 (#9) spans BC years, oldest first',
    fn() {
      const range = anthologyRange(loeb36, byId(loebWorks));
      equal(range.earliest, -399);
      equal(range.latest, -370);
    },
  },
  {
    name: 'an anthology lists the works still missing a dating',
    fn() {
      const undated = work('xx0nd4t3dw0k', 'Undated sermon');
      const book = edition('xxed1t10n0w1', 'Sermons', [na28Works[0].id, undated.id]);
      same(anthologyRange(book, byId([na28Works[0], undated])).missing, [undated.id]);
    },
  },
  {
    name: 'pages are counted as printed: roman front matter, journal ranges, sets',
    fn() {
      equal(countPages('311'), 311);
      equal(countPages('xxviii, 311'), 339);
      equal(countPages('xxviii, 311 p.'), 339);
      equal(countPages('89–132'), 44);
      equal(countPages('89*, 890'), 979);
      equal(countPages('4 v.'), null);
      equal(countPages(''), null);
      equal(countPages(null), null);
    },
  },
  {
    name: 'a measured or catalog height is used as it is',
    fn() {
      const book = { ...chadwick, height: 196, heightSource: 'catalog' };
      same(estimateSize(book).height, { mm: 196, source: 'catalog' });
    },
  },
  {
    name: 'a height is borrowed from the same series, then guessed from the binding',
    fn() {
      const known = { ...loeb36, id: 'k0eb26x7k2mq', height: 165, heightSource: 'measured' };
      same(estimateSize(loeb36, { related: [known] }).height, { mm: 165, source: 'same series' });
      same(estimateSize(chadwick, { binding: 'Paperback' }).height, { mm: 215, source: 'guess' });
      same(estimateSize(chadwick, { binding: 'Mass-market paperback' }).height, { mm: 178, source: 'guess' });
    },
  },
  {
    name: 'thickness comes from the page count, and a journal issue is thin',
    fn() {
      same(estimateSize(chadwick, { binding: 'Paperback' }).thickness, { mm: 20.8, source: 'pages' });
      const issue = { ...chadwick, pages: '89–132' };
      same(estimateSize(issue, { binding: 'Journal issue' }).thickness, { mm: 3.1, source: 'pages' });
    },
  },
  {
    name: '"logos" finds λόγος, and accents are ignored',
    fn() {
      equal(normalizeForSearch('λόγος'), 'logos');
      equal(normalizeForSearch('Église'), 'eglise');
      equal(normalizeForSearch('Φαίδων'), 'phaidon');
      equal(normalizeForSearch('Ἰησοῦς'), 'iesous');
      ok(matchesSearch(normalizeForSearch('Ὁ λόγος'), 'logos'), 'logos should match');
    },
  },
  {
    name: 'searching "Phaedo" finds Loeb 36 (#9), and so does "platon"',
    fn() {
      const text = searchTextOf(loeb36, byId(loebWorks), byId([plato]));
      ok(matchesSearch(text, 'Phaedo'), 'Phaedo');
      ok(matchesSearch(text, 'platon'), 'Platon');
      ok(matchesSearch(text, 'loeb 36'), 'series and number');
      ok(!matchesSearch(text, 'augustine'), 'not Augustine');
    },
  },
  {
    name: 'Augustine is found under any form of his name, and by the original title',
    fn() {
      const text = searchTextOf(chadwick, byId([confessions]), byId([augustine]));
      ok(matchesSearch(text, 'Aurelius'), 'other name');
      ok(matchesSearch(text, 'confessiones'), 'original title');
      ok(matchesSearch(text, '9780199537822'), 'ISBN');
      ok(matchesSearch(text, 'chadwick'), 'translator');
    },
  },
  {
    name: 'pasted contents read as author, title and an optional date (Loeb 36, #9)',
    fn() {
      const pasted = ['Plato — Euthyphro — c. 399 BC', 'Plato -- Apology', '', 'Romans 1–8', 'The Didache | c. 100–120'].join('\n');
      same(parseContentsLines(pasted), [
        { author: 'Plato', title: 'Euthyphro', date: 'c. 399 BC' },
        { author: 'Plato', title: 'Apology', date: null },
        { author: null, title: 'Romans 1–8', date: null },
        { author: null, title: 'The Didache', date: 'c. 100–120' },
      ]);
      equal(contentsLine(loebWorks[1], ['Plato']), 'Plato — Phaedo — c. 385 BC');
    },
  },
  {
    name: 'the library shows owned physical books by default, sorted by title',
    fn() {
      const copy = (id, edition, status = 'owned') => ({ type: 'copy', id, edition, status, location: [], binding: null, added: '2026-11-09', value: null, notes: '', trashed: null });
      const library = buildLibrary([...na28Works, na28, ...loebWorks, loeb36, plato, confessions, augustine, chadwick,
        copy('c0py00000001', na28.id), copy('c0py00000002', loeb36.id), copy('c0py00000003', chadwick.id, 'given away')]);
      same(viewEntries(library.entries).map(entry => entry.edition.title), ['Euthyphro. Apology. Crito. Phaedo. Phaedrus.', 'Novum Testamentum Graece']);
      equal(viewEntries(library.entries, { sort: 'originalDate' })[0].edition.title, 'Euthyphro. Apology. Crito. Phaedo. Phaedrus.', 'BC sorts first');
      equal(searchEntries(library.entries, 'chadwick').length, 1, 'search finds books no longer owned');
      equal(library.entries.find(entry => entry.id === na28.id).authorLine, '', 'no authors and no editors');
      equal(library.entries.find(entry => entry.id === loeb36.id).authorLine, 'Plato', 'the shared author of an anthology');
      equal(authorLineOf([{ authors: ['a'] }, { authors: ['b'] }], [{ name: 'Clement' }, { name: 'Polycarp' }], ['Michael W. Holmes']), 'ed. Michael W. Holmes', 'editors when authors differ');
    },
  },
];
