// Anthology date ranges, page counts, sizes and search, with the sample books.

import { anthologyRange } from '../anthology.js';
import { countPages } from '../pages.js';
import { estimateSize } from '../sizes.js';
import { normalizeForSearch, searchTextOf, matchesSearch } from '../search.js';
import { parseContentsLines, contentsLine } from '../contents.js';
import { buildLibrary, viewEntries, searchEntries, searchPieces, originalTextHolders, authorLineOf, sortEntries, filterChoices, missingDetails, SORTS } from '../library.js';
import { equal, same, ok } from './check.js';
import { newRecord } from '../records.js';
import { isBible, isBibleBook } from '../bible.js';
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
    name: 'a spine photo gives the thickness from the height',
    fn() {
      const book = { ...chadwick, height: 196, heightSource: 'catalog', images: [{ id: 'sp1n3000000x', kind: 'spine', source: 'photo', color: null, ratio: 0.1, master: true, waiting: null }] };
      same(estimateSize(book).thickness, { mm: 19.6, source: 'photo' });
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
      equal(searchEntries(library, 'chadwick').length, 1, 'search finds books no longer owned');
      equal(searchEntries(buildLibrary([...na28Works, na28], { searchText: false }), 'romans').length, 1, 'search works before the search text is built');
      equal(library.entries.find(entry => entry.id === na28.id).authorLine, '', 'no authors and no editors');
      equal(library.entries.find(entry => entry.id === loeb36.id).authorLine, 'Plato', 'the shared author of an anthology');
      equal(authorLineOf([{ authors: ['a'] }, { authors: ['b'] }], [{ name: 'Clement' }, { name: 'Polycarp' }], ['Michael W. Holmes']), 'ed. Michael W. Holmes', 'editors when authors differ');
    },
  },
  {
    name: 'titles sort with numbers in order and without "The", and books with no value go last',
    fn() {
      const entry = (title, value = null) => ({ edition: { title, year: null, series: null, set: null }, authorSort: '', location: [], value, sortYear: null, added: '' });
      const sorted = sortEntries([entry('Volume 10'), entry('The Volume 9'), entry('Apology'), entry('Écrits')], 'title');
      same(sorted.map(e => e.edition.title), ['Apology', 'Écrits', 'The Volume 9', 'Volume 10']);
      same(sortEntries([entry('A', null), entry('B', 50), entry('C', 90)], 'value').map(e => e.edition.title), ['C', 'B', 'A']);
    },
  },
  {
    name: 'filters: location (and every place inside it), category, tag, status and "needs original date"',
    fn() {
      const at = (id, title, location, status = 'owned', workExtra = {}, datings = [{ text: '1950', earliest: 1950, latest: 1950, certainty: 'exact', kind: 'published', note: null, working: true }]) => [
        work(`w${id}`, title, datings, workExtra),
        edition(`e${id}`, title, [`w${id}`]),
        newRecord('copy', `c${id}`, '2026-11-10T10:00:00Z', { edition: `e${id}`, location, status, added: '2026-11-10' }),
      ];
      const { entries } = buildLibrary([
        ...at('00000000001', 'Office A', ['Home', 'Office', 'Case 1'], 'owned', { category: 'Philosophy', tags: ['Greek'] }),
        ...at('00000000002', 'Office B', ['Home', 'Office', 'Case 2'], 'owned', { category: 'Theology' }),
        ...at('00000000003', 'Bedroom', ['Home', 'Bedroom'], 'owned', {}, []),
        ...at('00000000004', 'Sold one', ['Home', 'Office', 'Case 1'], 'sold'),
      ]);
      const titles = view => viewEntries(entries, view).map(entry => entry.edition.title);
      same(titles({ location: ['Home', 'Office'] }), ['Office A', 'Office B'], 'a room includes its cases; sold books stay out');
      same(titles({ location: ['Home', 'Office', 'Case 1'], status: 'all' }), ['Office A', 'Sold one']);
      same(titles({ status: 'sold' }), ['Sold one']);
      same(titles({ category: 'Philosophy' }), ['Office A']);
      same(titles({ tag: 'Greek' }), ['Office A']);
      same(titles({ needsDate: true }), ['Bedroom']);
      const choices = filterChoices(entries);
      same(choices.locations.map(path => path.join(' › ')), ['Home', 'Home › Bedroom', 'Home › Office', 'Home › Office › Case 1', 'Home › Office › Case 2']);
      same(choices.categories, ['Philosophy', 'Theology']);
      ok(['title', 'subtitle', 'author', 'originalDate', 'year', 'binding', 'series', 'category', 'location', 'value', 'added'].every(key => key in SORTS), 'every sort PLAN.md names');
    },
  },
  {
    name: '"needs details" lists physical books missing publisher, year, pages or binding',
    fn() {
      const copy = (id, editionId, binding) => newRecord('copy', id, '2026-11-11T10:00:00Z', { edition: editionId, binding, added: '2026-11-11' });
      const bare = edition('bare00000001', 'Luther\'s Works 31', [confessions.id], { set: 'Luther\'s Works', volume: '31' });
      const logos = edition('g0g0s0000001', 'Confessions', [confessions.id], { medium: 'logos' });
      const { entries } = buildLibrary([confessions, chadwick, bare, logos,
        copy('c0py00000011', chadwick.id, 'Paperback'), copy('c0py00000012', bare.id, null), copy('c0py00000013', logos.id, null)]);
      const find = id => entries.find(entry => entry.id === id);
      same(missingDetails(find(chadwick.id)), [], 'Chadwick has them all');
      same(missingDetails(find(bare.id)), ['publisher', 'year', 'pages', 'binding']);
      same(missingDetails(find(logos.id)), [], 'a Logos book never needs them');
      same(viewEntries(entries, { needsDetails: true, medium: 'all' }).map(entry => entry.id), [bare.id]);
      const withFound = { ...find(chadwick.id), edition: { ...chadwick, foundContents: [{ author: 'Augustine', title: 'Soliloquies', extent: null }] } };
      same(missingDetails(withFound), ['works found inside'], 'works the laptop found wait for a person');
    },
  },
  {
    name: 'sorted by original date, an anthology shows once, or under each work it holds when the setting says so',
    fn() {
      const copy = newRecord('copy', 'c0py00000009', '2026-11-10T10:00:00Z', { edition: loeb36.id, added: '2026-11-10' });
      const { entries } = buildLibrary([...loebWorks, loeb36, plato, copy]);
      equal(viewEntries(entries, { sort: 'originalDate' }).length, 1);
      const years = new Set(loebWorks.map(work => work.datings.find(dating => dating.working)?.earliest));
      equal(viewEntries(entries, { sort: 'originalDate' }, { anthologies: 'each' }).length, years.size, 'once for each distinct date');
      equal(viewEntries(entries, { sort: 'title' }, { anthologies: 'each' }).length, 1, 'other sorts show it once');
    },
  },
  {
    name: 'NA28 is a Bible by its books; the Concordia Triglotta and the Loeb Plato are not',
    fn() {
      const { entries } = buildLibrary([...na28Works, na28, ...triglottaWorks, triglotta, ...loebWorks, loeb36, plato]);
      const bible = title => isBible(entries.find(entry => entry.edition.title === title));
      same([bible('Novum Testamentum Graece'), bible('Concordia Triglotta'), bible(loeb36.title)], [true, false, false]);
      ok(isBible({ edition: { logosExtra: { 'Resource Type': 'Bible' } }, works: [{ title: 'Lexham English Bible' }] }), 'Logos says so');
      ok(isBible({ edition: {}, works: [{ title: 'Genesis' }, { title: 'Exodus' }, { title: 'Preface' }] }), 'contents read from a catalog record');
      same(['First Corinthians', '1 Corinthians', 'The Acts of the Apostles', 'Confessions'].map(isBibleBook), [true, true, true, false]);
    },
  },
  // Pieces and other titles (data format 3, phase 15 step 6).
  {
    name: 'a piece inside a book is found only in the folded "Also inside" search, and gives the book its date range',
    fn() {
      const raven = { work: null, piece: { title: 'The Raven', author: 'Edgar Allan Poe', originalTitle: null, date: '1845' }, extent: 'complete', translator: null, pages: '81–86', cite: false };
      const tales = work('t4lesw0rk001', 'Tales', [{ text: '1839', earliest: 1839, latest: 1839, certainty: 'exact', kind: null, note: '', working: true }]);
      const poe = edition('p0etryta1es1', 'Poetry and Tales', [tales.id], { contents: [{ work: tales.id, piece: null, extent: 'complete', translator: null, pages: null, cite: false }, raven] });
      const library = buildLibrary([tales, poe]);
      same(searchEntries(library, 'raven').map(entry => entry.id), [], 'not among the books');
      same(searchPieces(library, 'the raven').map(hit => [hit.entry.id, hit.piece.title]), [['p0etryta1es1', 'The Raven']]);
      same(searchPieces(library, 'poe raven').length, 1, 'by its author too');
      same(anthologyRange(poe, byId([tales])), { earliest: 1839, latest: 1845, count: 2, missing: [] });
      same(anthologyRange({ ...poe, contents: [{ ...raven, piece: { ...raven.piece, date: null } }] }, byId([])).missing, ['The Raven'], 'a piece without a date');
    },
  },
  {
    name: 'a work\'s other titles and abbreviations are searched ("Ethica Nicomachea", "Eth. Nic.")',
    fn() {
      const ethics = work('eth1csw0rk01', 'Nicomachean Ethics', [], { otherTitles: ['Ethica Nicomachea', 'Eth. Nic.'] });
      const book = edition('eth1csed0001', 'Nicomachean Ethics', [ethics.id]);
      const library = buildLibrary([ethics, book]);
      for (const query of ['ethica nicomachea', 'eth nic']) same(searchEntries(library, query).map(entry => entry.id), ['eth1csed0001'], query);
    },
  },
  {
    name: 'the original-text marker finds the books printing a work in its original language ("Greek" for "Ancient Greek"), not translations',
    fn() {
      const phaedo = work('phaed0w0rk01', 'Phaedo', [], { originalLanguage: 'Ancient Greek' });
      const loebPhaedo = edition('l0ebphaed001', 'Plato I', [phaedo.id], { languages: ['Greek', 'English'] });
      const hackett = edition('hackettph001', 'Complete Works', [phaedo.id], { languages: ['English'] });
      const library = buildLibrary([phaedo, loebPhaedo, hackett]);
      same(originalTextHolders(phaedo, library).map(entry => entry.id), ['l0ebphaed001']);
      same(originalTextHolders({ ...phaedo, originalLanguage: null }, library), [], 'no original language, no marker');
    },
  },
];
