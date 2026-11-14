// Known sets (phase 15, step 8): reading a set's list, finding a volume, and set gaps.

import { parseKnownSet, findKnownVolume, volumeFromText, contentsLinesOf, setGaps, wishesForGaps, recordsForKnownVolume } from '../known-sets.js';
import { parseContentsLines } from '../contents.js';
import { validateRecord } from '../validate.js';
import { equal, same, ok } from './check.js';

// A small list in the format of sets/*.txt (two volumes of a made-up printing).
const SAMPLE = `# A sample list, for the tests only.
set: Great Books of the Western World
publisher: Encyclopaedia Britannica
place: Chicago
year: 1990
edition: 2nd ed.
isbn: 0852295316

volume: 6 | Plato
Plato — Euthyphro | Εὐθύφρων | Greek — c. 399–395 BC | trans. Benjamin Jowett | pp. 1–8
Plato — Phaedo | Φαίδων | Greek — c. 360 BC | trans. Benjamin Jowett

volume: 7 | Aristotle I | isbn 9780852291999
Aristotle — Categories | Κατηγορίαι | Greek — 4th c. BC | trans. E. M. Edghill
Edgar Allan Poe — The Raven | | English — 1845 | piece
`;

export const tests = [
  {
    name: 'a known set\'s list is read with its set facts, volumes and works',
    fn() {
      const set = parseKnownSet(SAMPLE);
      same(set.problems, []);
      same([set.set, set.publisher, set.place, set.year, set.editionStatement, set.isbns], ['Great Books of the Western World', 'Encyclopaedia Britannica', 'Chicago', '1990', '2nd ed.', ['9780852295311']]);
      same(set.volumes.map(volume => [volume.label, volume.title, volume.works.length]), [['6', 'Plato', 2], ['7', 'Aristotle I', 2]]);
      const euthyphro = set.volumes[0].works[0];
      same([euthyphro.author, euthyphro.title, euthyphro.originalTitle, euthyphro.originalLanguage, euthyphro.date, euthyphro.translator, euthyphro.pages, euthyphro.piece],
        ['Plato', 'Euthyphro', 'Εὐθύφρων', 'Greek', 'c. 399–395 BC', 'Benjamin Jowett', '1–8', false]);
      equal(set.volumes[1].works[1].piece, true, 'a short poem is a piece');
    },
  },
  {
    name: 'a volume is found by its own ISBN, or by set and volume; an ISBN the whole set shares finds the set and asks which volume',
    fn() {
      const sets = [parseKnownSet(SAMPLE)];
      equal(findKnownVolume(sets, { isbn: '9780852291999' }).volume.title, 'Aristotle I');
      equal(findKnownVolume(sets, { set: 'great books of the western world', volume: 'vol. 6' }).volume.title, 'Plato');
      const shared = findKnownVolume(sets, { isbn: '9780852295311' });
      ok(shared && shared.volume === null, 'the set, without a volume');
      equal(findKnownVolume(sets, { isbn: '9780199537822' }), null, 'a book of no known set');
    },
  },
  {
    name: 'a later printing called by the set\'s name is found by the volume number in its subtitle or title',
    fn() {
      const sets = [parseKnownSet(SAMPLE)];
      // As Open Library describes a reprint of Luther's Works 12: the set's name as title, the volume in the subtitle.
      const reprint = findKnownVolume(sets, { isbn: '9780000000002', title: 'Great Books of the Western World', subtitle: 'Volume 7 - (Aristotle I)' });
      equal(reprint.volume.title, 'Aristotle I');
      equal(reprint.sharedIsbn, false, 'its own looked-up details are kept');
      equal(findKnownVolume(sets, { title: "Great Books of the Western World, Vol. 6" }).volume.title, 'Plato');
      ok(findKnownVolume(sets, { title: 'Great Books of the Western World' }).volume === null, 'no number: the set, and "Which volume?"');
      equal(findKnownVolume(sets, { title: 'Great Books for Children', subtitle: 'Volume 6' }), null, 'another title that only begins alike');
      equal(volumeFromText('Volume 12 - (Selected Psalms I)'), '12');
      equal(volumeFromText('Career of the Reformer I'), '');
    },
  },
  {
    name: 'a volume\'s works become contents lines that the entry form reads back the same',
    fn() {
      const [plato] = parseKnownSet(SAMPLE).volumes;
      same(parseContentsLines(contentsLinesOf(plato)), [{ author: 'Plato', title: 'Euthyphro', date: 'c. 399–395 BC' }, { author: 'Plato', title: 'Phaedo', date: 'c. 360 BC' }]);
    },
  },
  {
    name: 'set gaps list the volumes held and missing, in the list\'s order',
    fn() {
      same(setGaps(parseKnownSet(SAMPLE), ['7']), { held: ['7'], missing: ['6'] });
    },
  },
  {
    name: 'a list says who checked it; without that line it counts as not checked',
    fn() {
      equal(parseKnownSet(SAMPLE).checked, '');
      equal(parseKnownSet(SAMPLE.replace('isbn: 0852295316', 'isbn: 0852295316\nchecked: 2026-11-12 Jakob Nath')).checked, '2026-11-12 Jakob Nath');
    },
  },
  {
    name: 'a volume made without the entry form gets its works from the list, dated only when the list is checked',
    fn() {
      let counter = 0;
      const context = { newId: () => `kv${String(++counter).padStart(10, '0')}`, now: '2026-11-12T12:00:00Z', authorIds: names => names.map(name => `a-${name}`) };
      const aristotle = parseKnownSet(SAMPLE).volumes[1];
      const unchecked = recordsForKnownVolume(parseKnownSet(SAMPLE), aristotle, context);
      same(unchecked.works.map(work => [work.title, work.authors, work.originalTitle, work.originalLanguage, work.datings.length]), [['Categories', ['a-Aristotle'], 'Κατηγορίαι', 'Greek', 0]]);
      same(unchecked.contents.map(entry => [entry.work, entry.piece && entry.piece.title, entry.translator]), [[unchecked.works[0].id, null, 'E. M. Edghill'], [null, 'The Raven', null]]);
      const checked = parseKnownSet(SAMPLE.replace('edition: 2nd ed.', 'edition: 2nd ed.\nchecked: 2026-11-12 Jakob Nath'));
      const dated = recordsForKnownVolume(checked, checked.volumes[1], context).works[0];
      same([dated.datings[0].text, dated.datings[0].note], ['4th c. BC', 'from the Great Books of the Western World list']);
      same(validateRecord(dated), []);
    },
  },
  {
    name: 'missing volumes become wishlist items, one each, never twice',
    fn() {
      const set = parseKnownSet(SAMPLE);
      const items = wishesForGaps(set, ['6', '7'], [{ title: 'Great Books of the Western World 7: Aristotle I', trashed: null }]);
      same(items, [{ title: 'Great Books of the Western World 6: Plato', authors: 'Plato', publisher: 'Encyclopaedia Britannica', notes: '2nd ed., 1990' }]);
    },
  },
  {
    name: 'a work whose language is not known keeps its date',
    fn() {
      const set = parseKnownSet('set: Luther\'s Works\nvolume: 61 | Theological and Polemical Works\nMartin Luther — A Letter of Beelzebub to the Holy Papal Church | | — 1537 | trans. Nicholas D. Proksch');
      const work = set.volumes[0].works[0];
      same([work.originalLanguage, work.date, work.translator], ['', '1537', 'Nicholas D. Proksch']);
      same(set.problems, []);
    },
  },
  {
    name: 'a list with a work before any volume, a bad ISBN or no set name says so, line by line',
    fn() {
      const problems = parseKnownSet('isbn: 12345\nPlato — Euthyphro').problems;
      equal(problems.length, 3);
      ok(problems[0].startsWith('Line 1') && problems[1].startsWith('Line 2'), 'each names its line');
    },
  },
];
