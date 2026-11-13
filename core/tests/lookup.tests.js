// Reading lookup answers (recorded from Open Library on 9 November 2026, and
// in Google Books' documented format), and the matching suggestions.

import { fromOpenLibrary, fromGoogleBooks, combineFound, candidatesFromSearch, searchQueries, workFromOpenLibrary, suggestOriginalDates, yearFromText, titleCase } from '../lookup.js';
import { editionsWithIsbn, suggestWorks } from '../matching.js';
import { buildLibrary } from '../library.js';
import { equal, same, ok } from './check.js';
import { confessions, augustine, chadwick, byId } from './samples.js';

// Open Library's answer for #12 (Chadwick's Confessions), shortened.
const OPEN_LIBRARY = {
  'ISBN:9780199537822': {
    title: 'Confessions',
    authors: [{ name: 'Augustine of Hippo' }],
    number_of_pages: 311,
    pagination: 'xxviii, 311 p. ;',
    by_statement: 'Saint Augustine ; translated by Henry Chadwick.',
    publishers: [{ name: 'Oxford University Press' }],
    publish_places: [{ name: 'Oxford' }],
    publish_date: '2008',
    subjects: [{ name: 'Christian saints' }],
  },
};

const COVER = 'https://covers.openlibrary.org/b/isbn/9780199537822-L.jpg?default=false';

// Google Books' answer, in its documented shape.
const GOOGLE_BOOKS = {
  items: [{ volumeInfo: {
    title: 'Confessions', authors: ['Saint Augustine'], publisher: 'OUP Oxford', publishedDate: '2008-08-14',
    industryIdentifiers: [{ type: 'ISBN_10', identifier: '0199537828' }, { type: 'ISBN_13', identifier: '9780199537822' }],
    pageCount: 352, language: 'en', imageLinks: { thumbnail: 'http://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=1&edge=curl' },
  } }],
};

export const tests = [
  {
    name: 'an Open Library answer gives the edition fields, the translator, and a cover',
    fn() {
      const found = fromOpenLibrary(OPEN_LIBRARY, '9780199537822', COVER);
      equal(found.title, 'Confessions');
      same(found.authors, ['Augustine of Hippo']);
      equal(fromOpenLibrary({ 'ISBN:1': { title: 'The  cost of  discipleship ' } }, '1', '').title, 'The Cost of Discipleship', 'spaces tidied and title case');
      same(found.contributors, [{ name: 'Henry Chadwick', role: 'translator' }]);
      same([found.publisher, found.place, found.year, found.pages], ['Oxford University Press', 'Oxford', '2008', 'xxviii, 311']);
      equal(found.cover.url, COVER);
      equal(found.cover.waiting, false);
    },
  },
  {
    name: 'names with initials are kept whole, and a closing full stop is dropped',
    fn() {
      const answer = { 'ISBN:9780872208162': { title: 'Confessions', by_statement: 'Augustine ; translated by F. J. Sheed ; introduction by Peter Brown.' } };
      same(fromOpenLibrary(answer, '9780872208162', '').contributors, [{ name: 'F. J. Sheed', role: 'translator' }, { name: 'Peter Brown', role: 'introduction' }]);
      const early = { 'ISBN:9780881414271': { title: 'On the Incarnation', pagination: 'pages cm', number_of_pages: 110 } };
      equal(fromOpenLibrary(early, '9780881414271', '').pages, '110', 'a placeholder page field falls back to the count');
    },
  },
  {
    name: 'no lookup ever fills an original date',
    fn() {
      for (const found of [fromOpenLibrary(OPEN_LIBRARY, '9780199537822', COVER), fromGoogleBooks(GOOGLE_BOOKS, '9780199537822')]) {
        ok(!('datings' in found) && !('originalDate' in found), `${found.source} must not give a dating`);
      }
    },
  },
  {
    name: 'a Google Books cover waits for the laptop, and its gaps are filled from Open Library',
    fn() {
      const google = fromGoogleBooks(GOOGLE_BOOKS, '9780199537822');
      equal(google.cover.waiting, true);
      ok(google.cover.url.startsWith('https://') && !google.cover.url.includes('edge=curl'), 'a clean https address');
      same(google.languages, ['English']);
      const combined = combineFound(fromOpenLibrary(OPEN_LIBRARY, '9780199537822', COVER), google);
      equal(combined.publisher, 'Oxford University Press', 'Open Library comes first');
      same(combined.languages, ['English'], 'Google Books fills the gap');
      equal(combineFound(null, google).source, 'googlebooks');
    },
  },
  {
    name: 'an unknown ISBN gives nothing, so manual entry opens',
    fn() {
      equal(fromOpenLibrary({}, '9780000000002'), null);
      equal(fromGoogleBooks({ totalItems: 0 }, '9780000000002'), null);
    },
  },
  {
    name: 'a title search gives candidates with an ISBN-13 and a cover number where there are ones',
    fn() {
      const candidates = candidatesFromSearch({ docs: [{ title: 'Confessions', author_name: ['Augustine of Hippo'], first_publish_year: 1482, isbn: ['0199537828', '9780199537822'], cover_i: 8231856 }] });
      same(candidates, [{ title: 'Confessions', authors: ['Augustine of Hippo'], publisher: '', year: '1482', isbn: '9780199537822', cover: 8231856 }]);
    },
  },
  {
    name: 'a title search shows each work as its best-matching edition, in English and Latin letters, and the publisher\'s edition first',
    fn() {
      // Answers shaped as Open Library gave them on 2026-11-10.
      const asTyped = { docs: [{ key: '/works/OL12', title: 'Анна Каренина', author_name: ['Leo Tolstoy'], first_publish_year: 1876, editions: { docs: [{ title: 'Anna Karenina', publisher: ['Penguin'], publish_date: ['1997'], isbn: ['0140262997', '9780140262995'], cover_i: 10598462 }] } }] };
      const withPublisher = { docs: [{ key: '/works/OL12', title: 'Анна Каренина', author_name: ['Leo Tolstoy'], editions: { docs: [{ title: "Anna Karenina (Everyman's Library Classics)", publisher: ["Everyman's Library"], publish_date: ['April 23, 1992'], isbn: ['1857150589'], cover_i: 908565 }] } }] };
      const [anna] = candidatesFromSearch([withPublisher, asTyped]);
      same(anna, { title: "Anna Karenina (Everyman's Library Classics)", authors: ['Leo Tolstoy'], publisher: "Everyman's Library", year: '1992', isbn: '1857150589', cover: 908565 });
      equal(candidatesFromSearch([withPublisher, asTyped]).length, 1, 'one work, once');
      const noise = { docs: [{ key: '/works/A', title: 'Plotinos', author_name: ['Plotinus'], editions: { docs: [{ title: 'Plotinos', publisher: ['Platonist Press'] }] } }, { key: '/works/B', title: 'The Complete Works of Plato', author_name: ['Plato'], editions: { docs: [{ title: 'Complete works', publisher: ['Hackett Publishing Company'] }] } }] };
      equal(candidatesFromSearch([noise], 'complete works plato hackett')[0].publisher, 'Hackett Publishing Company', 'the result holding every word comes first');
      const plato = candidatesFromSearch({ docs: [{ key: '/works/OL1', title: 'The Complete Works of Plato', author_name: ['Πλάτων'], author_alternative_name: ['PLATO', 'Plato'], editions: { docs: [{ title: 'Complete works', publisher: ['Hackett Publishing Company'], isbn: ['9780872203495'] }] } }] })[0];
      same(plato.authors, ['Plato'], 'the author in Latin letters, written normally');
      equal(plato.publisher, 'Hackett Publishing Company');
      same(searchQueries("anna karenina everyman's library"), ["anna karenina everyman's library", 'anna karenina publisher:(everyman*)'], '"library" alone is too common to name a publisher');
      same(searchQueries('complete works plato hackett'), ['complete works plato hackett', 'complete works plato publisher:(hackett*)', 'complete works publisher:(plato* hackett*)']);
      same(searchQueries('confessions'), ['confessions'], 'one or two words: only as typed');
      equal(searchQueries('complete works of plato hackett')[0], 'complete works plato hackett', 'little words are left out');
    },
  },
  {
    name: 'a second Confessions (#13) is suggested to join the same work as #12, under another form of the name',
    fn() {
      const library = { worksById: byId([confessions]), authorsById: byId([augustine]) };
      same(suggestWorks('The Confessions', ['Augustine of Hippo'], library).map(work => work.id), [confessions.id]);
      same(suggestWorks('Confessions', ['Jean-Jacques Rousseau'], library), [], 'another author is not suggested');
    },
  },
  {
    name: 'scanning an ISBN already in the catalog (#16) finds the edition, to warn before adding',
    fn() {
      const library = buildLibrary([confessions, augustine, chadwick]);
      equal(editionsWithIsbn('9780199537822', library.entries).length, 1);
      equal(editionsWithIsbn('9780000000002', library.entries).length, 0);
    },
  },
  {
    name: 'Augustine: the earliest edition (1482) is after his death, so his lifetime is suggested',
    fn() {
      const work = workFromOpenLibrary({ docs: [{ title: 'Confessions', first_publish_year: 1482 }] }, { name: 'Augustine of Hippo', birth_date: '13 November 354', death_date: '28 August 430' });
      same(work.author, { name: 'Augustine of Hippo', born: 354, died: 430 });
      const suggestions = suggestOriginalDates(work, 1991);
      equal(suggestions.length, 1);
      equal(suggestions[0].text, '354–430');
      ok(suggestions[0].label.includes('later printing'), 'says why');
    },
  },
  {
    name: 'Chemnitz: an earliest edition after his death (1596) gives his lifetime, which holds 1565–73',
    fn() {
      const work = workFromOpenLibrary({ docs: [{ title: 'Examen Concilii Tridentini', first_publish_year: 1596 }] }, { name: 'Martin Chemnitz', birth_date: '1522', death_date: '1586' });
      equal(work.workTitle, 'Examen Concilii Tridentini', 'the original title, to suggest too');
      same(suggestOriginalDates(work, 2007).map(s => s.text), ['1522–1586']);
    },
  },
  {
    name: 'a modern translation: the first publication is suggested first, the lifetime second',
    fn() {
      const work = workFromOpenLibrary({ docs: [{ title: 'Nachfolge', first_publish_year: 1937 }] }, { name: 'Dietrich Bonhoeffer', birth_date: '4 February 1906', death_date: '9 April 1945' });
      same(suggestOriginalDates(work, 1995).map(s => s.text), ['1937', '1906–1945']);
    },
  },
  {
    name: 'a first publication in the same year as the printing is flagged for checking, and BC years read right',
    fn() {
      const suggestions = suggestOriginalDates({ firstPublished: 2007, author: null }, '2007');
      ok(suggestions[0].label.includes('check'), 'asks for a check');
      equal(yearFromText('c. 427 BC'), -427);
      same(suggestOriginalDates({ firstPublished: 1514, author: { name: 'Plato', born: -428, died: -348 } }, 1914).map(s => s.text), ['428–348 BC']);
    },
  },
  {
    name: 'dates written year first, or with A.D. or "B. C.", give the right year',
    fn() {
      equal(yearFromText('1802-07-24'), 1802);
      equal(yearFromText('1870-12-05'), 1870);
      equal(yearFromText('24 July 1802'), 1802);
      equal(yearFromText('43 B. C.'), -43);
      equal(yearFromText('17 A.D.'), 17);
      equal(yearFromText('13 November 354'), 354);
      equal(yearFromText(''), null);
    },
  },
  {
    name: 'Dumas: his dates written year first give his lifetime, not "24–5" (The Count of Monte Cristo)',
    fn() {
      const work = workFromOpenLibrary({ docs: [{ title: 'Le Comte de Monte-Cristo', first_publish_year: 1830 }] }, { name: 'Alexandre Dumas', birth_date: '1802-07-24', death_date: '1870-12-05' });
      same(suggestOriginalDates(work, 2003).map(s => s.text), ['1830', '1802–1870']);
    },
  },
  {
    name: 'Ovid: a first printing by 1500 is never offered as when the work was written (Metamorphoses, 1479)',
    fn() {
      const work = workFromOpenLibrary({ docs: [{ title: 'Metamorphoses', first_publish_year: 1479 }] }, { name: 'Ovid' });
      same(suggestOriginalDates(work, 1977), []);
    },
  },
  {
    name: 'titles in lower case get title case; titles with chosen capitals are left alone',
    fn() {
      equal(titleCase('The cost of discipleship'), 'The Cost of Discipleship');
      equal(titleCase('confessions'), 'Confessions');
      equal(titleCase('the dangers of christian practice: on wayward gifts'), 'The Dangers of Christian Practice: On Wayward Gifts');
      equal(titleCase('a history of the world in'), 'A History of the World In', 'a last word is capitalized');
      equal(titleCase('Greek New Testament: UBS5'), 'Greek New Testament: UBS5');
      equal(titleCase('Basics of Biblical Hebrew Grammar'), 'Basics of Biblical Hebrew Grammar');
    },
  },
];
