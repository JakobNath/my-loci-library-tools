// Small records for the core tests, taken from the sample books in
// docs/plan/SAMPLE_BOOKS.md (the number after each name is the sample book).

import { newRecord } from '../records.js';

const NOW = '2026-11-09T12:00:00Z';

function dating(text, earliest, latest, certainty, working = true, note = '') {
  return { text, earliest, latest, certainty, kind: null, note, working };
}

export function work(id, title, datings = [], extra = {}) {
  return newRecord('work', id, NOW, { title, datings, ...extra });
}

export function edition(id, title, workIds, extra = {}) {
  const contents = workIds.map(workId => ({ work: workId, extent: 'complete', translator: null, pages: null }));
  return newRecord('edition', id, NOW, { title, contents, ...extra });
}

// #6, NA28: a few of its 27 works, with a disputed one (2 Peter).
export const na28Works = [
  work('m4t7h3w2q9zk', 'Matthew', [dating('c. 80–90', 80, 90, 'circa')]),
  work('m4rk8x2p6ywa', 'Mark', [dating('c. 65–70', 65, 70, 'circa')]),
  work('r0m4n5x7k2pq', 'Romans', [dating('c. 57', 57, 57, 'circa')]),
  work('p2tr2x8m4kqd', '2 Peter', [
    dating('c. 65–68', 65, 68, 'circa', true, 'Petrine authorship'),
    dating('c. 100–150', 100, 150, 'circa', false, 'late dating'),
  ]),
  work('r3v3x9t1n0zq', 'Revelation', [dating('c. 95', 95, 95, 'circa')]),
];
export const na28 = edition('n2a8ed7v1kcx', 'Novum Testamentum Graece', na28Works.map(w => w.id), {
  languages: ['Greek'], publisher: 'Deutsche Bibelgesellschaft', place: 'Stuttgart', year: 2012, isbn: '9783438051400',
  editionStatement: '28th revised edition', pages: '89*, 890',
});

// #8, Concordia Triglotta: from the creeds (4th century) to 1577.
export const triglottaWorks = [
  work('n1c3n3cr33d0', 'Nicene Creed', [dating('325–381', 325, 381, 'range')]),
  work('a6g5b6rg1530', 'Augsburg Confession', [dating('1530', 1530, 1530, 'exact')]),
  work('f0rm6ka15770', 'Formula of Concord', [dating('1577', 1577, 1577, 'exact')]),
];
export const triglotta = edition('tr1g10tta921', 'Concordia Triglotta', triglottaWorks.map(w => w.id), {
  languages: ['German', 'Latin', 'English'], year: 1921, publisher: 'Concordia Publishing House',
});

// #9, Loeb 36: Plato, BC dates, a series number, author forms.
export const plato = newRecord('author', 'p1at0a6th0r1', NOW, { name: 'Plato', otherNames: ['Platon', 'Πλάτων'] });
export const loebWorks = [
  work('e6thyphr0x01', 'Euthyphro', [dating('c. 399 BC', -399, -399, 'circa')], { authors: [plato.id], originalTitle: 'Εὐθύφρων' }),
  work('ph2d0x8k1m4q', 'Phaedo', [dating('c. 385 BC', -385, -385, 'circa')], { authors: [plato.id], originalTitle: 'Φαίδων' }),
  work('ph2dr6sx9k3m', 'Phaedrus', [dating('c. 370 BC', -370, -370, 'circa')], { authors: [plato.id], originalTitle: 'Φαῖδρος' }),
];
export const loeb36 = edition('k0eb36x7k2mq', 'Euthyphro. Apology. Crito. Phaedo. Phaedrus.', loebWorks.map(w => w.id), {
  series: 'Loeb Classical Library', seriesNumber: '36', languages: ['Greek', 'English'], publisher: 'Harvard University Press',
  contributors: [{ name: 'Harold North Fowler', role: 'translator' }], year: 1914, isbn: '9780674990401',
});

// #12, Augustine, Confessions (Chadwick).
export const augustine = newRecord('author', 'a7g5s9t1n0e2', NOW, { name: 'Augustine', otherNames: ['Augustine of Hippo', 'Aurelius Augustinus'] });
export const confessions = work('c0nf3ss10n5x', 'Confessions', [dating('c. 397–400', 397, 400, 'circa')], {
  authors: [augustine.id], originalTitle: 'Confessiones', originalLanguage: 'Latin',
});
export const chadwick = edition('chadw1ck1991', 'Confessions', [confessions.id], {
  contributors: [{ name: 'Henry Chadwick', role: 'translator' }], publisher: 'Oxford University Press', place: 'Oxford',
  year: 1991, series: "Oxford World's Classics", isbn: '9780199537822', pages: 'xxviii, 311',
});

export function byId(records) {
  return new Map(records.map(record => [record.id, record]));
}
