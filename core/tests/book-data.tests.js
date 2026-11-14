// Reading the Library of Congress, Open Library's edition record and Google
// Books' volume record, and merging them (PLAN.md, "Book data"), against the
// answers recorded in core/tests/answers/ on 10 November 2026.

import { fromLibraryOfCongress, fromHathiTrust, heightInMm } from '../marc.js';
import { fromOpenLibraryEdition, fromGoogleBooksVolume, mergeFound, withLibraryContents, bindingFromFormat, sizesFromDimensions, googleKeyVerdict } from '../book-data.js';
import { fromOpenLibrary, fromGoogleBooks, contributorsFrom, cleanPages } from '../lookup.js';
import { equal, same, ok } from './check.js';
import * as confessions from './answers/9780199537822.js';
import * as crime from './answers/9780140449136.js';
import * as chemnitz from './answers/9780758615473.js';
import * as plato from './answers/9780872203495.js';
import * as lewis from './answers/9780060652920.js';
import * as loeb from './answers/9780674990401.js';
import * as anna from './answers/9781857150582.js';
import * as na28 from './answers/9783438051400.js';
import * as holmes from './answers/9780801031083.js';
import * as fathers from './answers/9780674996076.js';
import * as iliad from './answers/9780674995796.js';
import * as oct from './answers/9780198145288.js';
import * as greatBooks from './answers/9780852291634.js';
import * as poe from './answers/9780940450189.js';
import * as wikidata from './answers/wikidata.js';
import { worksQuery, worksFromWikidata, wikidataDateText, idsQuery, readIdChecks } from '../wikidata.js';
import { parseDating } from '../dating.js';

const json = text => (text === null ? null : JSON.parse(text));

// Every source's reading of one recorded book, best first, as the app and loci-enrich merge them.
function readAll(book) {
  return [
    fromLibraryOfCongress(book.libraryOfCongress, book.isbn),
    fromOpenLibraryEdition(json(book.openLibraryEdition), book.isbn),
    fromOpenLibrary(json(book.openLibraryData), book.isbn, ''),
    fromGoogleBooksVolume(json(book.googleBooksVolume), book.isbn),
  ];
}
const merged = book => mergeFound(readAll(book));
const names = found => found.contributors.map(person => `${person.name} (${person.role})`);

export const tests = [
  {
    name: 'Complete Works reads as its title page: Plato; edited by John M. Cooper; xxx, 1808 pages; 24 cm; Hackett, 1997',
    fn() {
      const found = merged(plato);
      same([found.title, found.authors], ['Complete Works', ['Plato']]);
      same(names(found), ['John M. Cooper (editor)', 'D.S. Hutchinson (other)'], 'the associate editor is not the editor');
      same([found.pages, found.height, found.publisher, found.place, found.year], ['xxx, 1808', 240, 'Hackett Publishing', 'Indianapolis, Ind.', '1997']);
      equal(found.originalLanguage, 'Ancient Greek');
      equal(found.originalTitle, '', '"Works" names a kind of collection, not an original title');
      same(found.identifiers, { lccn: '96053280', oclc: '', lcc: 'B358 .C3 1997', ddc: '184', openLibrary: 'OL49233743M', hathiTrust: '' });
      same(found.subjects, ['Socrates', 'Philosophy, Ancient']);
    },
  },
  {
    name: 'sizes that cannot be one book\'s are not used (Hackett\'s Plato 16.1 cm thick and 9.5 cm wide; a boxed set)',
    fn() {
      equal(fromGoogleBooksVolume(json(plato.googleBooksVolume), plato.isbn).thickness, null);
      same([merged(plato).height, merged(plato).thickness], [240, null], 'the Library of Congress still gives the height');
      same(sizesFromDimensions('14.1', '10', '8.5', 'inches'), { height: null, thickness: null }, 'the Ante-Nicene Fathers in their box');
      same(sizesFromDimensions('20', '13', '3', 'cm'), { height: 200, thickness: 30 });
      same(sizesFromDimensions('8.4', '5.4', '1.8', 'inches'), { height: 213, thickness: 46 });
    },
  },
  {
    name: 'Confessions: the translator, pages as printed, the series, Latin, and its catalogue numbers',
    fn() {
      const found = merged(confessions);
      same(names(found), ['Henry Chadwick (translator)']);
      same([found.pages, found.series, found.originalLanguage, found.height, found.thickness], ['xxviii, 311', "Oxford World's Classics", 'Latin', 200, 17]);
      same(found.identifiers, { lccn: '2008491261', oclc: '228195188', lcc: 'BR65.A6 E5 2008', ddc: '270.2092', openLibrary: 'OL23154103M', hathiTrust: '' });
    },
  },
  {
    name: 'Crime and Punishment: catalogue punctuation removed, the revised edition, and the original title in Russian',
    fn() {
      const found = merged(crime);
      same([found.title, found.editionStatement, found.place, found.publisher], ['Crime and Punishment', 'Rev. ed.', 'London', 'Penguin']);
      same(names(found), ['David McDuff (translator)'], 'the introduction is part of the translator\'s work');
      same([found.originalTitle, found.originalLanguage], ['Prestuplenie i nakazanie', 'Russian']);
      equal(found.identifiers.ddc, '891.733', 'the slash in a Dewey number is left out');
    },
  },
  {
    name: 'Loci Theologici, one ISBN of a set: no pages from a description of volumes, and the series with its numbers',
    fn() {
      const lc = fromLibraryOfCongress(chemnitz.libraryOfCongress, chemnitz.isbn);
      equal(lc.pages, '', '"v. <1-3>" is not a page count');
      same([lc.series, lc.seriesNumber, lc.height], ["Chemnitz's Works", '7, 8', 240]);
      same([lc.publisher, lc.place, lc.originalTitle], ['Concordia Publishing House', 'St. Louis, MO', ''], 'an original title the same as the title adds nothing');
      equal(cleanPages('v. <1-2> ;'), '');
      equal(cleanPages('2 v.'), '', 'a count of volumes');
      equal(cleanPages('xxv, 583 p.'), 'xxv, 583', 'roman numerals ending in v stay');
    },
  },
  {
    name: 'Mere Christianity: the subtitle in title case, the binding, and the top level of Open Library\'s contents',
    fn() {
      const found = merged(lewis);
      ok(found.subtitle.startsWith('A Revised and Amplified Edition, with a New Introduction'), found.subtitle);
      same([found.editionStatement, found.pages, found.height, found.binding], ['1st HarperCollins ed.', 'xx, 227', 220, 'Paperback']);
      same(found.contents.map(entry => entry.title), ['Right and Wrong as a Clue to the Meaning of the Universe', 'What Christians Believe',
        'Christian Behaviour', 'Beyond Personality: Or First Steps in the Doctrine of the Trinity']);
    },
  },
  {
    name: 'The Apostolic Fathers: contents from the Library of Congress, and one person as translator and editor',
    fn() {
      const found = merged(holmes);
      same(names(found), ['Michael W. Holmes (translator)', 'Michael W. Holmes (editor)']);
      same(found.contents.slice(0, 3).map(entry => entry.title), ['First Clement', 'Second Clement', 'The Letters of Ignatius']);
      equal(found.contents.length, 21);
      same([found.editionStatement, found.height, found.originalLanguage], ['3rd ed.', 230, 'Ancient Greek']);
    },
  },
  {
    name: 'a book the Library of Congress does not know (the Loeb Plato) is filled from Open Library and Google Books',
    fn() {
      equal(fromLibraryOfCongress(loeb.libraryOfCongress, loeb.isbn), null);
      const found = merged(loeb);
      same([found.publisher, found.pages, found.height], ['Harvard University Press', '608', 170]);
      equal(found.identifiers.oclc, '44991830');
    },
  },
  {
    name: 'Anna Karenina: roles from Open Library\'s contributions, sizes in inches, and a hardcover',
    fn() {
      const found = merged(anna);
      same(names(found), ['John Bayley (introduction)', 'Louise Maude (translator)', 'Aylmer Maude (translator)']);
      same([found.height, found.thickness, found.binding], [213, 46, 'Hardcover']);
    },
  },
  {
    name: 'a value is taken only from a record that lists the book\'s own ISBN',
    fn() {
      equal(fromLibraryOfCongress(plato.libraryOfCongress, confessions.isbn), null);
      equal(fromOpenLibraryEdition(json(plato.openLibraryEdition), confessions.isbn), null);
      equal(fromGoogleBooksVolume(json(plato.googleBooksVolume), confessions.isbn), null);
      equal(fromGoogleBooks(json(anna.googleBooksSearch), anna.isbn).title, 'Anna Karenina', 'not Democracy in America, which carries the same ISBN');
      ok(fromGoogleBooks(json(loeb.googleBooksSearch), loeb.isbn).title.startsWith('Euthyphro'), 'library scans without an ISBN are passed over');
    },
  },
  {
    name: 'the Library of Congress comes first for bibliographic facts, and pages as printed beat a page count',
    fn() {
      const [lc, edition, , volume] = readAll(plato);
      same([edition.year, edition.pages, volume.pages], ['2009', '1838', '1808']);
      const found = mergeFound([lc, edition, volume]);
      same([found.year, found.pages], ['1997', 'xxx, 1808']);
      equal(mergeFound([volume, { ...lc, pages: 'xxx, 1808' }]).pages, 'xxx, 1808', 'printed pages win even from a later source');
      equal(mergeFound([null, null]), null);
    },
  },
  {
    name: 'no source ever produces an original date, and a Bible is read like any book',
    fn() {
      for (const book of [confessions, crime, chemnitz, plato, lewis, loeb, anna, na28, holmes]) {
        const found = merged(book);
        ok(!('datings' in found) && !('originalDate' in found), `${book.isbn} has a date field`);
      }
      equal(merged(na28).binding, 'Paperback');
    },
  },
  {
    name: 'by lines name translators, editors and introductions as a person reads them',
    fn() {
      same(contributorsFrom('edited by Robert Kolb and Timothy J. Wengert ; translated by Charles Arand ... [et al.].'),
        [{ name: 'Robert Kolb', role: 'editor' }, { name: 'Timothy J. Wengert', role: 'editor' }, { name: 'Charles Arand', role: 'translator' }]);
      same(contributorsFrom('Leo Tolstoy ; introduction by John Sutherland ; illustrated by Roman Pisarev.'),
        [{ name: 'John Sutherland', role: 'introduction' }, { name: 'Roman Pisarev', role: 'illustrator' }]);
      same(contributorsFrom('C.S. Lewis'), []);
    },
  },
  {
    name: 'bindings and heights as records write them',
    fn() {
      same(['Hardcover', 'paperback', 'Mass Market Paperback', 'Leather Bound', 'Bonded Leather', 'Library Binding', 'Audio CD'].map(bindingFromFormat),
        ['Hardcover', 'Paperback', 'Mass-market paperback', 'Leather', 'Bonded leather', 'Library binding', '']);
      same([heightInMm('24 cm.'), heightInMm('24 x 30 cm'), heightInMm('maps ;')], [240, 240, null]);
    },
  },
  {
    name: 'volumes, parts and front matter are not offered as works, and a bookseller\'s "New Ed edition" reads "New ed."',
    fn() {
      const set = '<record xmlns="http://www.loc.gov/MARC21/slim"><datafield tag="020" ind1=" " ind2=" "><subfield code="a">9780758615404</subfield></datafield>'
        + '<datafield tag="245" ind1="1" ind2="0"><subfield code="a">Examination of the Council of Trent.</subfield></datafield>'
        + '<datafield tag="505" ind1="0" ind2=" "><subfield code="a">V. 1. Part I -- v. 2. Part II -- Introduction -- Index.</subfield></datafield></record>';
      same(fromLibraryOfCongress(set, '9780758615404').contents, []);
      equal(fromOpenLibraryEdition({ title: 'Anna Karenina', isbn_13: [anna.isbn], edition_name: 'New Ed edition' }, anna.isbn).editionStatement, 'New ed.');
      equal(merged(holmes).contents.length, 21, 'the works of a real anthology stay');
    },
  },
  {
    name: '"Test the key" says plainly whether a Google Books key works, and why not',
    fn() {
      equal(googleKeyVerdict(200, { items: [] }).works, true);
      // Google's answer to a key it does not know, as sent on 10 November 2026.
      const invalid = { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT',
        errors: [{ reason: 'badRequest' }], details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } };
      ok(googleKeyVerdict(400, invalid).message.includes('copied whole'), 'an unknown key');
      ok(googleKeyVerdict(403, { error: { code: 403, details: [{ reason: 'SERVICE_DISABLED' }] } }).message.includes('Enable'), 'the Books API is off');
      ok(googleKeyVerdict(403, { error: { code: 403, details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }] } }).message.includes('Books API'), 'restricted to other services');
      ok(googleKeyVerdict(429, null).message.includes('limit'), 'the daily limit');
      equal(googleKeyVerdict(500, null).message, 'Google Books refused the key (500).');
    },
  },
  // HathiTrust and set records (phase 15, step 3), against answers recorded on 11 November 2026.
  {
    name: 'HathiTrust gives the five dialogues of Loeb Plato I, each by Plato, from a title that lists them',
    fn() {
      const found = fromHathiTrust(loeb.hathiTrust, loeb.isbn);
      equal(found.source, 'hathitrust');
      same(found.contents.map(entry => `${entry.author} — ${entry.title}`), ['Plato — Euthyphro', 'Plato — Apology', 'Plato — Crito', 'Plato — Phaedo', 'Plato — Phaedrus']);
      same([found.series, found.seriesNumber, found.pages], ['Loeb Classical Library', '36', 'xxv, 583']);
      equal(found.set, '', 'a record for this volume alone, not the set');
    },
  },
  {
    name: 'a set record gives the set, the ISBN\'s volume and only that volume\'s works, in HathiTrust and the Library of Congress alike',
    fn() {
      for (const found of [fromHathiTrust(fathers.hathiTrust, fathers.isbn), fromLibraryOfCongress(fathers.libraryOfCongress, fathers.isbn)]) {
        same([found.title, found.set, found.volume, found.pages], ['', 'The Apostolic Fathers', '1', ''], `${found.source}: the set, not its title or "2 v."`);
        same(found.contents.map(entry => entry.title), ['I Clement', 'II Clement', 'Ignatius', 'Polycarp', 'Didache'], `${found.source}: volume 1 only`);
      }
    },
  },
  {
    name: 'a volume holding part of one work (the Iliad, books 1-12) offers no contents',
    fn() {
      const found = fromHathiTrust(iliad.hathiTrust, iliad.isbn);
      same([found.set, found.volume, found.contents.length, found.originalLanguage], ['Iliad', '1', 0, 'Ancient Greek']);
    },
  },
  {
    name: 'records of different books sharing one ISBN (Great Books of the Western World) give nothing rather than one of them at random',
    fn() {
      equal(fromHathiTrust(greatBooks.hathiTrust, greatBooks.isbn), null);
      equal(fromHathiTrust(poe.hathiTrust, poe.isbn), null, 'a book HathiTrust does not hold');
      equal(fromHathiTrust('not an answer', poe.isbn), null, 'an answer that is not JSON');
    },
  },
  {
    name: 'when only a set\'s record knew the book, it is called by the set and its volume; another source\'s title comes first',
    fn() {
      const homer = fromHathiTrust(oct.hathiTrust, oct.isbn);
      equal(mergeFound([homer]).title, 'Opera, vol. 1');
      equal(mergeFound([homer, { ...homer, source: 'openlibrary', title: 'Homeri Opera I', set: '', volume: '' }]).title, 'Homeri Opera I');
      equal(mergeFound([homer]).set, 'Opera');
    },
  },
  {
    name: 'on the phone Open Library\'s facts come first, but the works inside come from a library record that lists them',
    fn() {
      const openLibrary = { ...fromHathiTrust(loeb.hathiTrust, loeb.isbn), source: 'openlibrary', year: '2005', contents: [{ title: 'Introduction', author: '' }, { title: 'Euthyphro', author: '' }] };
      const hathi = fromHathiTrust(loeb.hathiTrust, loeb.isbn);
      const found = withLibraryContents(mergeFound([openLibrary, hathi]), [openLibrary, hathi]);
      equal(found.year, '2005', 'the printing in hand');
      equal(found.contents.length, 5, 'the five dialogues');
      equal(withLibraryContents(null, [hathi]), null);
    },
  },
  {
    name: 'a book without an ISBN is found by its LCCN or OCLC number, as typed or as catalogued',
    fn() {
      const byLccn = fromHathiTrust(fathers.hathiTrust, { lccn: '2003032744' });
      same([byLccn.title, byLccn.isbn, byLccn.identifiers.lccn], ['The Apostolic Fathers', '', '2003032744']);
      equal(fromLibraryOfCongress(fathers.libraryOfCongress, { lccn: '2002032744' }).title, 'The Apostolic Fathers', 'the Library of Congress gives its own LCCN');
      equal(fromHathiTrust(fathers.hathiTrust, { oclc: '(OCoLC)56058333' }).title, 'The Apostolic Fathers', 'by OCLC number, as catalogued');
      equal(fromHathiTrust(fathers.hathiTrust, { lccn: '1234567' }), null, 'a number no record has');
    },
  },
  // Wikidata (phase 15, step 7), against answers recorded on 12 November 2026.
  {
    name: 'Wikidata dates the five dialogues of Loeb Plato I and gives their Greek titles and standard abbreviations',
    fn() {
      const found = worksFromWikidata(JSON.parse(wikidata.plato.answer), wikidata.plato.titles);
      same([...found.keys()], ['Euthyphro', 'Apology', 'Crito', 'Phaedo', 'Phaedrus']);
      same(['wikidata', 'date', 'originalTitle'].map(key => found.get('Phaedo')[key]), ['Q244161', 'c. 360 BC', 'Φαίδων']);
      ok(found.get('Phaedo').otherTitles.includes('Plat. Phaedo'), 'the standard abbreviation');
      equal(found.get('Crito').wikidata, 'Q267634', 'of the two items called "Crito", only the dated dialogue');
      for (const [title, work] of found) ok(parseDating(work.date).ok, `${title}: "${work.date}" reads as a date`);
    },
  },
  {
    name: 'Wikidata dates Poe\'s tales by when they were written or first published, not by later editions',
    fn() {
      const found = worksFromWikidata(JSON.parse(wikidata.poe.answer), wikidata.poe.titles);
      same(['The Raven', 'The Fall of the House of Usher', 'The Cask of Amontillado', 'Ligeia'].map(title => found.get(title).date), ['1845', '1839', '1846', '1838']);
      equal(found.get('The Raven').originalTitle, '', 'an English work has no other original title');
    },
  },
  {
    name: 'of two dated items with one title, Wikidata\'s well-described, long-known one is taken; two alike are left out',
    fn() {
      // Shortened from Wikidata's answer of 14 November 2026 for "Pride and Prejudice" by Austen.
      const row = (id, time, extra = {}) => ({ work: { value: `http://www.wikidata.org/entity/${id}` }, title: { value: 'Pride and Prejudice' },
        time: { value: time }, precision: { value: '11' }, ...extra });
      const answer = { results: { bindings: [row('Q108809625', '2015-01-01T00:00:00Z'), row('Q170583', '1813-01-28T00:00:00Z', { other: { value: 'First Impressions' } })] } };
      equal(worksFromWikidata(answer, ['Pride and Prejudice']).get('Pride and Prejudice').date, '1813');
      const alike = { results: { bindings: [row('Q500', '1813-01-28T00:00:00Z'), row('Q900', '2015-01-01T00:00:00Z')] } };
      equal(worksFromWikidata(alike, ['Pride and Prejudice']).size, 0, 'neither stands out');
    },
  },
  {
    name: 'a Wikidata date is written as a person types one, so the date parser reads it',
    fn() {
      same([wikidataDateText('-0360-01-01T00:00:00Z', 8), wikidataDateText('-0400-01-01T00:00:00Z', 7), wikidataDateText('+1845-01-29T00:00:00Z', 11), wikidataDateText('+1900-01-01T00:00:00Z', 7), wikidataDateText('+2000-01-01T00:00:00Z', 6)],
        ['c. 360 BC', '4th c. BC', '1845', '19th c.', '']);
    },
  },
  {
    name: 'the Wikidata query uses only standard SPARQL, asks all of a book\'s titles at once, and asks nothing without an author',
    fn() {
      const query = worksQuery(['The Raven', 'Say "hello"'], 'Edgar Allan Poe');
      ok(!query.includes('wikibase:label') && !query.includes('mwapi'), 'no label service');
      ok(query.includes('"The Raven"@en') && query.includes('"Raven"@en'), 'with and without the article');
      ok(query.includes('"Say \\"hello\\""@en'), 'quotes escaped');
      ok(query.includes('"poe"'), 'by the author\'s surname');
      equal(worksQuery(['Didache'], ''), '', 'an anonymous work is not asked by title alone');
    },
  },
  {
    name: 'stored Wikidata IDs are checked again: a merged item gives its new ID, a deleted one is named, a live one is left alone',
    fn() {
      ok(idsQuery(['Q68', 'not an id']).includes('wd:Q68') && !idsQuery(['Q68', 'not an id']).includes('not an id'));
      equal(idsQuery([]), '');
      const changes = readIdChecks(wikidata.idChecks, ['Q68', 'Q21697683', 'Q999999999999']);
      same([...changes], [['Q21697683', { mergedInto: 'Q68' }], ['Q999999999999', { missing: true }]]);
    },
  },
];
