// The entry form's records: sample books entered from scratch, editing
// that stamps only what changed, and ISBNs.

import { recordsFromForm, isbn13, anotherCopy, isBookBarcode } from '../entry.js';
import { validateRecord } from '../records.js';
import { equal, same, ok } from './check.js';

let counter = 0;
const context = (authors = []) => ({ newId: () => `t${String(++counter).padStart(11, '0')}`.replace(/[ilou]/g, 'x'), now: '2026-11-09T12:00:00Z', today: '2026-11-09', authors });

function blankForm(values) {
  return {
    title: '', subtitle: '', authors: [], contributors: [], publisher: '', place: '', year: '', editionStatement: '',
    translationFirstPublished: '', series: '', seriesNumber: '', set: '', volume: '', isbn: '', pages: '', languages: [],
    medium: 'physical', logosId: '', contents: null,
    work: { title: '', originalTitle: '', originalLanguage: '', category: '', tags: [], datings: [] },
    copy: { binding: '', location: ['', '', '', ''], acquired: '', price: '', value: '', status: 'owned', markings: false, notes: '' },
    ...values,
  };
}

export const tests = [
  {
    name: 'the custom Imitation of Christ (#20) is entered from scratch, with no ISBN or publisher',
    fn() {
      const form = blankForm({
        title: 'The Imitation of Christ', authors: ['Thomas à Kempis'],
        work: { title: '', originalTitle: 'De Imitatione Christi', originalLanguage: 'Latin', category: '', tags: [], datings: [{ text: 'c. 1418–27', note: '', working: true }] },
        copy: { binding: 'Hand-bound leather', location: ['Home', '', '', ''], acquired: '', price: '', value: '120', status: 'owned', markings: false, notes: 'Custom made.' },
      });
      const result = recordsFromForm(form, null, context());
      same(result.problems, []);
      same(result.records.map(record => record.type), ['author', 'work', 'edition', 'copy']);
      for (const record of result.records) same(validateRecord(record), [], record.type);
      const work = result.records[1];
      same([work.datings[0].earliest, work.datings[0].latest, work.datings[0].certainty], [1418, 1427, 'circa']);
      same(result.records[3].valueHistory, [{ date: '2026-11-09', value: 120 }]);
      same(result.records[3].location, ['Home']);
    },
  },
  {
    name: 'NA28 (#6) is entered by pasting its contents, one work per line',
    fn() {
      const form = blankForm({ title: 'Novum Testamentum Graece', isbn: '978-3-438-05140-0', languages: ['Greek'], contents: 'Matthew — c. 80–90\nMark — c. 65–70\nRomans — c. 57' });
      const result = recordsFromForm(form, null, context());
      same(result.problems, []);
      const edition = result.records.find(record => record.type === 'edition');
      equal(edition.contents.length, 3);
      equal(edition.isbn, '9783438051400');
    },
  },
  {
    name: 'editing changes and stamps only the fields that changed, and reuses existing authors',
    fn() {
      const first = recordsFromForm(blankForm({ title: 'Confessions', authors: ['Augustine'] }), null, context());
      const author = first.records.find(record => record.type === 'author');
      const existing = {
        edition: first.records.find(record => record.type === 'edition'),
        copy: first.records.find(record => record.type === 'copy'),
        works: first.records.filter(record => record.type === 'work'),
      };
      const again = recordsFromForm(blankForm({ title: 'Confessions', authors: ['augustine'], copy: { ...blankForm({}).copy, value: '30' } }), existing, context([author]));
      same(again.records.map(record => record.type), ['copy'], 'only the copy changed');
      same(Object.keys(again.records[0].changed).sort(), ['value', 'valueHistory']);
    },
  },
  {
    name: 'a bad date or ISBN is refused with a plain message, and nothing is saved',
    fn() {
      const result = recordsFromForm(blankForm({ title: 'Test', isbn: '12345', work: { ...blankForm({}).work, datings: [{ text: 'sometime', working: true }] } }), null, context());
      equal(result.records.length, 0);
      ok(result.problems.some(problem => problem.includes('not an ISBN')), 'ISBN');
      ok(result.problems.some(problem => problem.includes('Could not read')), 'date');
    },
  },
  {
    name: 'an ISBN-10 becomes an ISBN-13',
    fn() {
      equal(isbn13('0-19-953782-6'), '9780199537822');
      equal(isbn13('9780199537822'), '9780199537822');
      equal(isbn13('not an isbn'), null);
    },
  },
  {
    name: 'a book confirmed as the same work links to it and adds no new work (#13 joins #12)',
    fn() {
      const first = recordsFromForm(blankForm({ title: 'Confessions', authors: ['Augustine'] }), null, context());
      const work = first.records.find(record => record.type === 'work');
      const second = recordsFromForm(blankForm({ title: 'Confessions', workId: work.id, work: { ...blankForm({}).work, datings: [{ text: 'c. 397–400', working: true }] } }),
        null, { ...context(), works: new Map([[work.id, work]]) });
      same(second.problems, []);
      const types = second.records.map(record => record.type);
      ok(!types.includes('author'), 'no new author');
      same(types, ['work', 'edition', 'copy'], 'the work only gains its missing dating');
      equal(second.records[1].contents[0].work, work.id);
    },
  },
  {
    name: 'another copy of an edition is one new copy record (#16)',
    fn() {
      const copy = anotherCopy('n2a8ed7v1kcx', { binding: 'Leather-like', location: ['Home', 'Bedroom', '', ''], shelfOrder: 'g', notes: '' }, context());
      same([copy.type, copy.edition, copy.binding, copy.shelfOrder], ['copy', 'n2a8ed7v1kcx', 'Leather-like', 'g']);
      same(copy.location, ['Home', 'Bedroom']);
    },
  },
  {
    name: 'only a valid ISBN barcode is taken as a book',
    fn() {
      ok(isBookBarcode('9780199537822'), 'a real ISBN');
      ok(!isBookBarcode('9780199537823'), 'a wrong check digit');
      ok(!isBookBarcode('4006381333931'), 'a product barcode, not a book');
    },
  },
];
