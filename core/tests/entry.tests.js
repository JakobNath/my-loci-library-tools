// The entry form's records: sample books entered from scratch, editing
// that stamps only what changed, and ISBNs.

import { recordsFromForm, isbn13, anotherCopy, isBookBarcode, wishFromForm, formFromWish, isbnInText, volumesFromLines, nextVolumeLabel, withSetFacts, worksFromRows } from '../entry.js';
import { emptyFound } from '../lookup.js';
import { sameWikidataWorks } from '../matching.js';
import { validateRecord } from '../validate.js';
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
    name: 'contents from a known set take each work\'s original title, language and translator; a piece stays inside the book; a changed line is saved as typed',
    fn() {
      const knownWorks = { set: 'Great Books of the Western World', works: [
        { author: 'Plato', title: 'Phaedo', originalTitle: 'Φαίδων', originalLanguage: 'Greek', date: 'c. 360 BC', translator: 'Benjamin Jowett', pages: '', piece: false },
        { author: 'Plato', title: 'Crito', originalTitle: 'Κρίτων', originalLanguage: 'Greek', date: 'c. 399 BC', translator: 'Benjamin Jowett', pages: '', piece: false },
        { author: 'Edgar Allan Poe', title: 'The Raven', originalTitle: '', originalLanguage: 'English', date: '1845', translator: '', pages: '', piece: true },
      ] };
      const form = blankForm({ title: 'Plato', contents: 'Plato — Phaedo — c. 360 BC\nPlato — Crito — 4th c. BC\nEdgar Allan Poe — The Raven — 1845', knownWorks });
      const result = recordsFromForm(form, null, context());
      same(result.problems, []);
      const works = result.records.filter(record => record.type === 'work');
      same(works.map(work => [work.title, work.originalTitle, work.originalLanguage, work.datings[0].note]),
        [['Phaedo', 'Φαίδων', 'Greek', 'from the Great Books of the Western World list'], ['Crito', 'Κρίτων', 'Greek', '']], 'a date typed over the list\'s has no list note');
      const edition = result.records.find(record => record.type === 'edition');
      same(edition.contents.map(entry => entry.translator), ['Benjamin Jowett', 'Benjamin Jowett', null]);
      same(edition.contents[2].piece, { title: 'The Raven', author: 'Edgar Allan Poe', originalTitle: null, date: '1845' });
      equal(edition.contents[2].work, null);
      for (const record of result.records) same(validateRecord(record), [], record.type);
    },
  },
  {
    name: 'a work the list puts in two volumes stays one work: the second volume links to the first volume\'s work',
    fn() {
      const knownWorks = { set: 'Great Books of the Western World', works: [
        { author: 'Edward Gibbon', title: 'The Decline and Fall of the Roman Empire', originalTitle: '', originalLanguage: 'English', date: '1776–1789', translator: '', pages: '', piece: false },
      ] };
      const lines = 'Edward Gibbon — The Decline and Fall of the Roman Empire — 1776–1789';
      const first = recordsFromForm(blankForm({ title: 'Gibbon I', contents: lines, knownWorks }), null, context());
      const work = first.records.find(record => record.type === 'work');
      const second = recordsFromForm(blankForm({ title: 'Gibbon II', contents: lines, knownWorks }), null, { ...context(), setWorks: [work] });
      equal(second.records.filter(record => record.type === 'work').length, 0, 'no second work');
      equal(second.records.find(record => record.type === 'edition').contents[0].work, work.id);
    },
  },
  {
    name: 'volumes of a set pasted one per line give each its label and title',
    fn() {
      same(volumesFromLines('7 Plato\n8 Aristotle I\n\n  I/1 The Doctrine of the Word of God\n31\nIV – Church Dogmatics', 'Great Books'), [
        { volume: '7', title: 'Plato' },
        { volume: '8', title: 'Aristotle I' },
        { volume: 'I/1', title: 'The Doctrine of the Word of God' },
        { volume: '31', title: 'Great Books, vol. 31' },
        { volume: 'IV', title: 'Church Dogmatics' },
      ]);
      same(volumesFromLines('Aristotle I', 'Great Books'), [{ volume: '', title: 'Aristotle I' }], 'no label first: all title');
    },
  },
  {
    name: 'the next volume label counts on from the last number',
    fn() {
      equal(nextVolumeLabel('31'), '32');
      equal(nextVolumeLabel('I/1'), 'I/2');
      equal(nextVolumeLabel('9'), '10');
      equal(nextVolumeLabel('IV'), '', 'Roman numerals are left to the person');
      equal(nextVolumeLabel(''), '');
    },
  },
  {
    name: 'a scanned volume of Luther\'s Works takes the set\'s facts and keeps its own year',
    fn() {
      const set = { title: 'Luther\'s Works', publisher: 'Fortress Press', year: '1955', editionStatement: 'American edition', editors: ['Jaroslav Pelikan', 'Helmut T. Lehmann'], binding: 'Hardcover' };
      const found = { ...emptyFound('Open Library'), isbn: '9780800603311', title: 'Career of the Reformer I', publisher: 'Muhlenberg', year: 1957, contributors: [{ name: 'Helmut T. Lehmann', role: 'editor' }] };
      const volume = withSetFacts(found, set, '31');
      equal(volume.set, 'Luther\'s Works');
      equal(volume.volume, '31');
      equal(volume.publisher, 'Fortress Press', 'the set\'s publisher');
      equal(volume.year, 1957, 'the volume\'s own year');
      equal(volume.binding, 'Hardcover');
      same(volume.contributors.map(person => person.name), ['Helmut T. Lehmann', 'Jaroslav Pelikan'], 'each editor once');
      equal(withSetFacts({ ...found, year: null }, set, '32').year, '1955', 'the set\'s year when none was found');
      equal(found.set, '', 'the input is unchanged (an empty set, as emptyFound gives)');
    },
  },
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
    name: '"Possibly the same as…": a work Wikidata names with the same item is offered, and joined only when a person chose it',
    fn() {
      const phaedo = { ...recordsFromForm(blankForm({ title: 'Phaedo', authors: ['Plato'] }), null, context()).records.find(record => record.type === 'work'), wikidata: 'Q1059449' };
      const worksById = new Map([[phaedo.id, phaedo]]);
      const found = new Map([['Phaedo', { wikidata: 'Q1059449' }], ['Crito', { wikidata: 'Q1131620' }]]);
      same([...sameWikidataWorks(found, worksById)].map(([title, work]) => [title, work.id]), [['Phaedo', phaedo.id]], 'only the work with the same item');
      const lines = 'Plato — Crito\nPlato — Phaedo';
      const apart = recordsFromForm(blankForm({ title: 'Five Dialogues', contents: lines }), null, { ...context(), works: worksById });
      equal(apart.records.filter(record => record.type === 'work').length, 2, 'not joined on its own');
      const joined = recordsFromForm(blankForm({ title: 'Five Dialogues', contents: lines, sameWorks: { phaedo: phaedo.id } }), null, { ...context(), works: worksById });
      equal(joined.records.filter(record => record.type === 'work').length, 1, 'only Crito is new');
      equal(joined.records.find(record => record.type === 'edition').contents[1].work, phaedo.id);
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
  {
    name: 'a wishlist item is made from its small form, edited field by field, and fills the entry form when bought',
    fn() {
      equal(wishFromForm({ title: ' ' }, null, context()).problems.length, 1, 'a title is needed');
      const { record } = wishFromForm({ title: 'Theological Commonplaces', authors: 'Johann Gerhard', translator: 'Richard J. Dinda', publisher: 'Concordia Publishing House', isbn: '', notes: 'Any volume; about $45 new.' }, null, context());
      same(validateRecord(record), []);
      same(record.contributors, [{ name: 'Richard J. Dinda', role: 'translator' }]);
      const edited = wishFromForm({ title: 'Theological Commonplaces', authors: 'Johann Gerhard', translator: 'Richard J. Dinda', publisher: 'Concordia Publishing House', notes: 'Volume 1 first.' }, record, { ...context(), now: '2026-11-10T09:00:00Z' }).record;
      same(Object.keys(edited.changed), ['notes'], 'only the note changed');
      const start = formFromWish(edited);
      equal(start.edition.title, 'Theological Commonplaces');
      equal(start.authorsText, 'Johann Gerhard');
      equal(start.notes, 'Volume 1 first.', 'the note goes to the new copy');
    },
  },
  {
    name: 'an ISBN is read from what was typed or from an Amazon link, and nothing else is taken for one',
    fn() {
      equal(isbnInText('https://www.amazon.com/Birth-Tragedy-Oxford-Worlds-Classics/dp/0199540144/ref=sr_1_1?keywords=birth'), '9780199540143');
      equal(isbnInText('https://www.amazon.com/gp/product/0199540144'), '9780199540143');
      equal(isbnInText('978-0-19-954014-3'), '9780199540143');
      equal(isbnInText('https://www.amazon.com/dp/B07XYZ1234'), null, 'a Kindle link has no ISBN');
      equal(isbnInText('https://a.co/d/abc123'), null, 'a short link has no ISBN');
      equal(isbnInText('The Birth of Tragedy 1872'), null, 'a title with a year is a title');
    },
  },
  // Collections made easy (phase 15, step 5).
  {
    name: 'a book turned into a collection sends its first work to the trash, unless another book holds it',
    fn() {
      const first = recordsFromForm(blankForm({ title: 'The Complete Works', authors: ['Michel de Montaigne'] }), null, context());
      const existing = { edition: first.records.find(r => r.type === 'edition'), copy: first.records.find(r => r.type === 'copy'), works: first.records.filter(r => r.type === 'work') };
      const authors = first.records.filter(r => r.type === 'author');
      const contents = 'Michel de Montaigne — Essays\nMichel de Montaigne — Travel Journal\nMichel de Montaigne — Letters';
      const alone = recordsFromForm(blankForm({ title: 'The Complete Works', contents }), existing, { ...context(authors), usedElsewhere: () => false });
      same(alone.records.filter(r => r.trashed).map(r => r.id), [existing.works[0].id], 'the old single work');
      const shared = recordsFromForm(blankForm({ title: 'The Complete Works', contents }), existing, { ...context(authors), usedElsewhere: () => true });
      equal(shared.records.filter(r => r.trashed).length, 0, 'held by another book: kept');
      const unknown = recordsFromForm(blankForm({ title: 'The Complete Works', contents }), existing, context(authors));
      equal(unknown.records.filter(r => r.trashed).length, 0, 'without knowing, nothing is trashed');
    },
  },
  {
    name: 'a line taken out of a collection\'s contents sends that work to the trash; the others are kept as they were',
    fn() {
      const first = recordsFromForm(blankForm({ title: 'Plato I', contents: 'Plato — Euthyphro\nPlato — Apology\nPlato — Crito' }), null, context());
      const works = first.records.filter(r => r.type === 'work');
      const existing = { edition: first.records.find(r => r.type === 'edition'), copy: first.records.find(r => r.type === 'copy'), works };
      const again = recordsFromForm(blankForm({ title: 'Plato I', contents: 'Plato — Euthyphro\nPlato — Apology' }), existing, { ...context(first.records.filter(r => r.type === 'author')), usedElsewhere: () => false });
      same(again.records.filter(r => r.trashed).map(r => r.title), ['Crito']);
      equal(again.records.find(r => r.type === 'edition').contents.length, 2);
    },
  },
  {
    name: 'the new works of a collection take the language, category and tags asked once for the whole book',
    fn() {
      const work = { ...blankForm({}).work, originalLanguage: 'Greek', category: 'Patristics', tags: ['Church order'] };
      const result = recordsFromForm(blankForm({ title: 'The Apostolic Fathers I', contents: 'I Clement\nDidache', work }), null, context());
      const works = result.records.filter(r => r.type === 'work');
      same(works.map(w => [w.title, w.originalLanguage, w.category, w.tags.join()]), [['I Clement', 'Greek', 'Patristics', 'Church order'], ['Didache', 'Greek', 'Patristics', 'Church order']]);
      same(works.map(w => w.originalTitle), [null, null], 'no shared original title');
    },
  },
  {
    name: '"Works in this book" saves each work\'s fields, fills empty ones from "same for all", and keeps a disputed work\'s datings',
    fn() {
      const made = recordsFromForm(blankForm({ title: 'The Apostolic Fathers I', contents: 'I Clement — c. 96\nDidache\nPolycarp' }), null, context());
      const works = new Map(made.records.filter(r => r.type === 'work').map(w => [w.id, w]));
      const [clement, didache, polycarp] = [...works.values()];
      const disputed = { ...didache, datings: [{ text: 'c. 50–70', earliest: 50, latest: 70, certainty: 'circa', kind: null, note: 'early dating', working: false }, { text: 'c. 100–120', earliest: 100, latest: 120, certainty: 'circa', kind: null, note: 'majority view', working: true }] };
      works.set(didache.id, disputed);
      const row = (work, values) => ({ id: work.id, title: work.title, originalTitle: '', originalLanguage: '', dating: work.datings[0] ? work.datings[0].text : '', category: '', tags: [], ...values });
      const result = worksFromRows([
        row(clement, { originalTitle: 'Πρὸς Κορινθίους', category: 'Patristics' }),
        row(disputed, { dating: 'c. 50–70' }),
        row(polycarp, { dating: 'c. 110–140' }),
      ], { originalLanguage: 'Greek', category: 'Apostolic Fathers', tags: ['Early church'] }, works, '2026-11-12T00:00:00Z');
      same(result.problems, []);
      const after = new Map(result.records.map(w => [w.id, w]));
      same([after.get(clement.id).originalTitle, after.get(clement.id).category, after.get(clement.id).originalLanguage], ['Πρὸς Κορινθίους', 'Patristics', 'Greek'], 'its own category wins; the language comes from same for all');
      equal(after.get(clement.id).datings[0].text, 'c. 96', 'an unchanged date stays');
      equal(after.get(didache.id).datings.length, 2, 'a disputed work keeps both datings');
      same([after.get(polycarp.id).datings[0].earliest, after.get(polycarp.id).category], [110, 'Apostolic Fathers']);
      same(Object.keys(after.get(clement.id).changed).sort(), ['category', 'originalLanguage', 'originalTitle', 'tags'], 'only what changed is stamped');
      equal(worksFromRows([row(clement, { title: ' ' })], { originalLanguage: '', category: '', tags: [] }, works, 'x').problems.length, 1, 'a work needs a title');
      equal(worksFromRows([row(polycarp, { dating: 'sometime' })], { originalLanguage: '', category: '', tags: [] }, works, 'x').records.length, 0, 'an unreadable date saves nothing');
    },
  },
];
