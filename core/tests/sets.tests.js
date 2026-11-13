// Sets with their own record (data format 4): counting a set's value once,
// the switch that counts one value for the whole set, the insurance CSV,
// finding a volume by the set's short form ("LW 31"), linking volumes to the
// set, and a copy's binding in three parts. The set is Luther's Works, which
// Jakob is gathering volume by volume.

import { newRecord, withField } from '../records.js';
import { buildLibrary, searchEntries, missingDetails } from '../library.js';
import { valueSummary, copyValueOf } from '../value.js';
import { valueCsv, catalogCsv } from '../exports.js';
import { setFromForm, editionsOfSet, linkEditionsToSet, volumesOfSet } from '../sets.js';
import { recordsFromForm } from '../entry.js';
import { listValues, renameValue } from '../lists.js';
import { validateRecord } from '../validate.js';
import { equal, same, ok } from './check.js';

const NOW = '2026-11-12T12:00:00Z';
const TODAY = '2026-11-12';

const lw = (values = {}) => newRecord('set', 'setw0rks0001', NOW, { title: 'Luther\'s Works', shortTitle: 'LW', editors: ['Jaroslav Pelikan', 'Helmut T. Lehmann'], volumes: 55, price: 700, value: 900, ...values });
const work = newRecord('work', 'wrk000000031', NOW, { title: 'Career of the Reformer' });
const volume = (label, values = {}) => newRecord('edition', `edv${label.padStart(9, '0')}`, NOW, {
  title: `Luther's Works, vol. ${label}`, contents: [{ work: work.id, piece: null, extent: 'complete', translator: null, pages: null, cite: false }],
  set: 'Luther\'s Works', volume: label, setRecord: 'setw0rks0001', ...values,
});
const copy = (label, values = {}) => newRecord('copy', `cpy${label.padStart(9, '0')}`, NOW, { edition: `edv${label.padStart(9, '0')}`, added: TODAY, location: ['Home', 'Office', 'Case 1'], ...values });

// Volumes 31 and 32 bought with the set (no value of their own), 56 bought alone for 40.
const records = (set = lw()) => [set, work, volume('31'), volume('32'), volume('56'), copy('31'), copy('32'), copy('56', { value: 40, price: 35 })];

export const tests = [
  {
    name: 'a set\'s value counts once, beside a volume bought alone; volumes bought with it are valued with the set, not missing',
    fn() {
      const summary = valueSummary(buildLibrary(records()).entries);
      same([summary.total, summary.count, summary.missing], [940, 3, 0]);
      same(summary.sets.map(row => [row.set.title, row.place, row.volumes]), [['Luther\'s Works', 'Home › Office', 3]]);
      same(copyValueOf(copy('31'), lw()), { value: null, withSet: true });
      same(copyValueOf(copy('56', { value: 40 }), lw()), { value: 40, withSet: false });
    },
  },
  {
    name: 'with "count one value for the whole set" on, only the set\'s value counts, and the volumes keep their own values',
    fn() {
      const set = lw({ valueAsSet: true });
      const all = records(set).map(record => (record.id === 'cpy000000031' ? withField(record, 'value', 25, NOW) : record));
      const summary = valueSummary(buildLibrary(all).entries);
      same([summary.total, summary.missing], [900, 0], 'not 900 + 25 + 40');
      equal(all.find(record => record.id === 'cpy000000056').value, 40, 'the value bought alone is kept, only not counted');
      equal(copyValueOf(copy('56', { value: 40 }), set).withSet, true);
    },
  },
  {
    name: 'a set with no value of its own changes nothing: its volumes count their own values, and those with none are missing',
    fn() {
      const summary = valueSummary(buildLibrary(records(lw({ value: null, valueAsSet: true }))).entries);
      same([summary.total, summary.missing, summary.sets.length], [40, 2, 0]);
    },
  },
  {
    name: 'a set is counted where most of its volumes stand, and a set held only in Logos goes to the Logos total',
    fn() {
      const moved = records().map(record => (record.id === 'cpy000000056' ? withField(record, 'location', ['Home', 'Bedroom'], NOW) : record));
      const byRoom = valueSummary(buildLibrary(moved).entries).byPlace.map(row => [row.place, row.total]);
      same(byRoom, [['Home › Office', 900], ['Home › Bedroom', 40]]);
      const logos = records().map(record => (record.type === 'edition' ? withField(record, 'medium', 'logos', NOW) : record));
      const summary = valueSummary(buildLibrary(logos).entries);
      same([summary.total, summary.logosTotal, summary.sets[0].isDigital], [0, 940, true]);
    },
  },
  {
    name: 'the insurance CSV gives the set one row, and each volume bought with it says so',
    fn() {
      const csv = valueCsv(buildLibrary(records()).entries);
      ok(csv.includes('Luther\'s Works (the whole set: 3 volumes owned),Jaroslav Pelikan; Helmut T. Lehmann,,,,Home › Office,900'), 'one row for the set');
      ok(csv.includes('Home › Office › Case 1,in the set Luther\'s Works'), 'a volume valued with the set');
      ok(csv.includes('Home › Office › Case 1,40'), 'the volume bought alone keeps its value');
      ok(csv.includes('Total,,,,,,940'));
    },
  },
  {
    name: '"LW 31" finds volume 31 of Luther\'s Works by the set\'s short form',
    fn() {
      const library = buildLibrary(records());
      same(searchEntries(library, 'LW 31').map(entry => entry.id), ['edv000000031']);
      equal(library.entries.find(entry => entry.id === 'edv000000031').set.shortTitle, 'LW');
      equal(searchEntries(buildLibrary(records().filter(record => record.type !== 'set')), 'LW 31').length, 0, 'without the set record there is no short form');
    },
  },
  {
    name: 'a set\'s form: a title is needed, the volumes are a whole number, and a changed value joins the history once a day',
    fn() {
      const context = { newId: () => 'setw0rks0002', now: NOW, today: TODAY };
      same(setFromForm({ title: '' }, null, context).problems, ['A set needs a title.']);
      ok(setFromForm({ title: 'LW', volumes: '5.5' }, null, context).problems[0].includes('whole number'));
      ok(setFromForm({ title: 'LW', price: 'cheap' }, null, context).problems[0].includes('price'));
      const { record } = setFromForm({ title: ' Luther\'s Works ', shortTitle: 'LW', editors: 'Jaroslav Pelikan; Helmut T. Lehmann', volumes: '55', price: '700', value: '900', valueAsSet: true }, null, context);
      same([record.title, record.editors, record.volumes, record.value, record.valueAsSet, record.valueHistory], ['Luther\'s Works', ['Jaroslav Pelikan', 'Helmut T. Lehmann'], 55, 900, true, [{ date: TODAY, value: 900 }]]);
      same(validateRecord(record), []);
      const later = setFromForm({ ...record, editors: record.editors.join('; '), volumes: '55', value: '950' }, record, { ...context, now: '2026-11-13T09:00:00Z', today: '2026-11-13' }).record;
      same(later.valueHistory.map(point => point.value), [900, 950]);
      same(Object.keys(later.changed), ['value', 'valueHistory'], 'only what changed is stamped');
    },
  },
  {
    name: '"Add the set\'s details" links every volume with that set title, whatever its capitals, but not a volume of another set',
    fn() {
      const set = lw();
      const editions = [volume('31', { setRecord: null }), volume('32', { setRecord: null, set: 'luther\'s works' }), volume('33', { setRecord: 'setw0rks0009' }), volume('34', { setRecord: null, set: 'Church Dogmatics' })];
      same(editionsOfSet(editions, set).map(edition => edition.volume), ['31', '32']);
      const linked = linkEditionsToSet(editionsOfSet(editions, set), set, NOW);
      same(linked.map(edition => [edition.setRecord, edition.set]), [['setw0rks0001', 'Luther\'s Works'], ['setw0rks0001', 'Luther\'s Works']]);
      equal(linkEditionsToSet(linked, set, NOW).length, 0, 'nothing changes the second time');
      const renamed = linkEditionsToSet(linked, { ...set, title: 'Luther\'s Works, American Edition' }, NOW);
      same(renamed.map(edition => edition.set), ['Luther\'s Works, American Edition', 'Luther\'s Works, American Edition'], 'renaming the set renames it on every volume');
    },
  },
  {
    name: 'a set\'s volumes come in number order, with the numbers not held',
    fn() {
      const { held, missing } = volumesOfSet(buildLibrary(records()).entries, lw());
      same(held.map(entry => entry.edition.volume), ['31', '32', '56'], '56 after 32, not after 3');
      equal(missing.length, 53, 'of 1 to 55, all but 31 and 32');
      ok(!missing.includes('31') && missing.includes('30'));
      const small = volumesOfSet(buildLibrary([lw({ volumes: 3 }), work, volume('2'), copy('2')]).entries, lw({ volumes: 3 }));
      same(small.missing, ['1', '3']);
    },
  },
  {
    name: 'editing a volume keeps its link to the set, unless its set title is changed to another set',
    fn() {
      const edition = volume('31');
      const existing = { edition, copy: copy('31'), works: [work] };
      const form = {
        title: edition.title, subtitle: '', contributors: [], publisher: '', place: '', year: '', editionStatement: '', translationFirstPublished: '',
        series: '', seriesNumber: '', set: 'Luther\'s Works', volume: '31', isbn: '', pages: '', languages: [], medium: 'physical', logosId: '', contents: null,
        authors: [], work: { title: work.title, originalTitle: '', originalLanguage: '', category: '', tags: [], datings: [] },
        copy: { binding: 'Hardcover', material: 'Cloth', extras: ['Dust jacket'], location: ['Home', 'Office', 'Case 1', ''], acquired: '', price: '', value: '', status: 'owned', markings: false, notes: '' },
      };
      const context = { newId: () => 'n0tneeded000', now: NOW, today: TODAY, authors: [] };
      const kept = recordsFromForm(form, existing, context).records;
      equal(kept.find(record => record.type === 'edition'), undefined, 'the edition did not change');
      same(['binding', 'material', 'extras'].map(name => kept.find(record => record.type === 'copy')[name]), ['Hardcover', 'Cloth', ['Dust jacket']]);
      const moved = recordsFromForm({ ...form, set: 'Church Dogmatics' }, existing, context).records.find(record => record.type === 'edition');
      equal(moved.setRecord, null);
    },
  },
  {
    name: 'a copy\'s binding shows its three parts, counts for "Needs details", and each part can be renamed in Lists',
    fn() {
      const parts = { binding: 'Hardcover', material: 'Cloth', extras: ['Dust jacket'] };
      const all = [...records(), withField(withField(withField(copy('32'), 'binding', null, NOW), 'material', 'Cloth', NOW), 'extras', ['Dust jacket'], NOW)];
      const library = buildLibrary(all.map(record => (record.id === 'cpy000000031' ? { ...record, ...parts } : record)));
      equal(library.entries.find(entry => entry.id === 'edv000000031').binding, 'Hardcover · Cloth · Dust jacket');
      ok(!missingDetails(library.entries.find(entry => entry.id === 'edv000000032')).includes('binding'), 'a material alone is a binding given');
      ok(missingDetails(library.entries.find(entry => entry.id === 'edv000000056')).includes('binding'));
      ok(catalogCsv(library.entries).includes('Hardcover · Cloth · Dust jacket'), 'the catalog CSV');
      const copies = [{ ...copy('31'), ...parts }, { ...copy('32'), extras: ['Dust jacket', 'Dustjacket'] }];
      same(listValues(copies, 'extra').map(item => [item.value, item.count]), [['Dust jacket', 2], ['Dustjacket', 1]]);
      same(renameValue(copies, 'extra', 'Dustjacket', 'Dust jacket', NOW).map(changed => changed.extras), [['Dust jacket']], 'merged, once');
      same(renameValue(copies, 'material', 'Cloth', 'Buckram', NOW).map(changed => changed.material), ['Buckram']);
    },
  },
];
