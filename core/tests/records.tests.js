// Records, IDs, merging, shelf order, HTML escaping and the CSL mapping.

import { makeId, isId, ID_ALPHABET } from '../ids.js';
import { newRecord, withField, validateRecord, recordToFileText, FIELDS, migrate, FORMAT_VERSION } from '../records.js';
import { mergeRecords } from '../merge.js';
import { keyBetween, keysForShelf } from '../shelf-order.js';
import { escapeHtml } from '../html.js';
import { editionToCsl, cslName, volumeOfSet, editionForCitation } from '../zotero.js';
import { equal, same, ok, throws } from './check.js';
import { SHARED_DEFAULTS, settingsToFileText, isAnotherCatalog } from '../settings.js';
import { trashBook, restoreBook, trashedItems } from '../trash.js';
import { listValues, renameValue } from '../lists.js';
import { buildLibrary, viewEntries } from '../library.js';
import { na28, na28Works, loeb36, loebWorks, plato, chadwick, confessions, augustine, byId } from './samples.js';

const NOW_TEST = '2026-11-10T12:00:00Z';

const T1 = '2026-11-09T10:00:00Z';
const T2 = '2026-11-09T11:00:00Z';

export const tests = [
  {
    name: 'an ID is 12 letters from the alphabet without i, l, o and u',
    fn() {
      const id = makeId(new Uint8Array([0, 31, 32, 63, 255, 7, 8, 9, 10, 11, 12, 13]));
      equal(id, '0z0zz789abcd', 'each byte picks one letter');
      equal(id.length, 12);
      ok(isId(id), 'is an ID');
      ok(!/[ilou]/.test(ID_ALPHABET), 'no i, l, o, u');
      ok(!isId('na28edition1'), 'i and o are refused');
      throws(() => makeId(new Uint8Array(4)), 'too few bytes');
    },
  },
  {
    name: 'a new record has every field, in the order of DATA_FORMAT.md',
    fn() {
      const record = newRecord('copy', 'c0pyna280001', T1, { edition: na28.id, added: '2026-11-09' });
      same(Object.keys(record), ['format', 'type', 'id', ...Object.keys(FIELDS.copy), 'trashed', 'created', 'changed']);
      same(validateRecord(record), []);
    },
  },
  {
    name: 'the sample records are valid',
    fn() {
      for (const record of [na28, ...na28Works, loeb36, ...loebWorks, plato, chadwick, confessions, augustine]) {
        same(validateRecord(record), [], record.title || record.name);
      }
    },
  },
  {
    name: 'validation explains what is wrong in plain words',
    fn() {
      const broken = { ...na28, contents: [], medium: 'scroll', isbn: '12345' };
      const problems = validateRecord(broken);
      ok(problems.some(p => p.includes('at least one work')), 'contents');
      ok(problems.some(p => p.includes('physical or logos')), 'medium');
      ok(problems.some(p => p.includes('13 digits')), 'ISBN');
      const twoWorking = { ...na28Works[3], datings: na28Works[3].datings.map(d => ({ ...d, working: true })) };
      ok(validateRecord(twoWorking).some(p => p.includes('Exactly one dating')), 'one working dating');
      ok(validateRecord({ ...chadwick, format: 3 }).some(p => p.includes('version 3')), 'newer format');
    },
  },
  {
    name: 'a file is pretty-printed with keys in order and a newline at the end',
    fn() {
      const text = recordToFileText(chadwick);
      ok(text.endsWith('}\n'), 'newline at the end');
      ok(text.startsWith('{\n  "format": 2,\n  "type": "edition",\n  "id": "chadw1ck1991",\n  "title"'), 'key order');
      same(JSON.parse(text), JSON.parse(recordToFileText(JSON.parse(text))), 'stable when rewritten');
      ok(text.includes('"contributors": [\n    {\n      "name": "Henry Chadwick",\n      "role": "translator"'), 'nested order');
    },
  },
  {
    name: 'editing a field stamps it and leaves the original untouched',
    fn() {
      const edited = withField(chadwick, 'year', 2008, T2);
      equal(edited.year, 2008);
      equal(edited.changed.year, T2);
      equal(chadwick.year, 1991, 'original unchanged');
      throws(() => withField(chadwick, 'id', 'x', T2), 'the ID cannot be edited');
    },
  },
  {
    name: 'merging takes each field from the side that changed it last',
    fn() {
      const base = newRecord('copy', 'c0pyna280001', T1, { edition: na28.id, added: '2026-11-09' });
      const phone = withField(base, 'notes', 'From the phone', T1);
      const laptop = withField(withField(base, 'value', 45, T2), 'notes', 'From the laptop', T2);
      const merged = mergeRecords(phone, laptop);
      equal(merged.notes, 'From the laptop');
      equal(merged.value, 45);
      same(mergeRecords(laptop, phone), merged, 'the same in either order');
      const onlyPhone = withField(base, 'binding', 'Hardcover', T1);
      equal(mergeRecords(onlyPhone, laptop).binding, 'Hardcover', 'a change on one side is kept');
    },
  },
  {
    name: 'a copy can always be placed between two others on a shelf',
    fn() {
      equal(keyBetween('m', 'n'), 'mg');
      const keys = keysForShelf(30);
      same([...keys].sort(), keys, 'keys sort in scan order');
      for (let i = 0; i + 1 < keys.length; i++) {
        const middle = keyBetween(keys[i], keys[i + 1]);
        ok(keys[i] < middle && middle < keys[i + 1], `between ${keys[i]} and ${keys[i + 1]}`);
      }
      ok(keyBetween(null, keys[0]) < keys[0], 'before the first');
      ok(keyBetween(keys[29], null) > keys[29], 'after the last');
      throws(() => keyBetween('n', 'm'), 'out of order');
    },
  },
  {
    name: 'text from data is escaped before it goes into HTML',
    fn() {
      equal(escapeHtml('<b>"Tom" & \'Jerry\'</b>'), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
      equal(escapeHtml(null), '');
    },
  },
  {
    name: 'an edition becomes a CSL item with its original date (Confessions, #12)',
    fn() {
      const item = editionToCsl(chadwick, byId([confessions]), byId([augustine]));
      equal(item.type, 'book');
      same(item.author, [{ literal: 'Augustine' }]);
      same(item.translator, [{ family: 'Chadwick', given: 'Henry' }]);
      same(item.issued, { 'date-parts': [[1991]] });
      same(item['original-date'], { 'date-parts': [[397]] });
      equal(item['collection-title'], "Oxford World's Classics");
    },
  },
  {
    name: 'a collection of many authors is cited under its editors, and a volume of a set keeps the set as its title',
    fn() {
      const clement = newRecord('author', 'c1ementr0me1', NOW_TEST, { name: 'Clement of Rome' });
      const ignatius = newRecord('author', '1gnat1usant1', NOW_TEST, { name: 'Ignatius of Antioch' });
      const works = [newRecord('work', 'w0rk0000000g', NOW_TEST, { title: '1 Clement', authors: [clement.id] }), newRecord('work', 'w0rk0000000h', NOW_TEST, { title: 'Letters of Ignatius', authors: [ignatius.id] })];
      const anf = newRecord('edition', 'anf0v0lume01', NOW_TEST, {
        title: 'The Ante-Nicene Fathers', subtitle: 'Volume 1: The Apostolic Fathers, Justin Martyr, Irenaeus', set: 'The Ante-Nicene Fathers', volume: '1',
        contents: works.map(work => ({ work: work.id, extent: 'complete', translator: null, pages: null })), contributors: [{ name: 'Alexander Roberts', role: 'editor' }],
      });
      const item = editionToCsl(anf, byId(works), byId([clement, ignatius]));
      same(item.author, [], 'no authors: Clement and Ignatius are not the authors of the volume');
      same(item.editor, [{ family: 'Roberts', given: 'Alexander' }]);
      equal(item.title, 'The Ante-Nicene Fathers');
      equal(item.volume, '1');
      equal(item['volume-title'], 'The Apostolic Fathers, Justin Martyr, Irenaeus');
      equal(editionToCsl(loeb36, byId(loebWorks), byId([plato])).author[0].literal, 'Plato', 'a collection by one author keeps its author');
      equal(volumeOfSet({ ...anf, subtitle: 'Volume 1' }).volumeTitle, '', 'a volume with no title of its own');
      equal(editionForCitation('3rd edition'), '3', 'printed as "3rd ed."');
      equal(editionForCitation('Third edition'), '3');
      equal(editionForCitation('28th revised edition'), '28th rev. ed.');
      equal(editionForCitation('Revised and expanded edition'), 'rev. and exp. ed.', 'lowercase: the style capitalizes it where Chicago does');
    },
  },
  {
    name: 'an anthology has no original date of its own (Loeb 36, #9); premodern names stay whole',
    fn() {
      const item = editionToCsl(loeb36, byId(loebWorks), byId([plato]));
      equal(item['original-date'], undefined, 'not "orig. 399 BC" for a collection of five dialogues');
      equal(item['collection-number'], '36');
      same(cslName('Martin Chemnitz', 'Chemnitz, Martin'), { family: 'Chemnitz', given: 'Martin' });
      same(cslName('Charles Dickens'), { family: 'Dickens', given: 'Charles' });
      for (const name of ['Ignatius of Antioch', 'Clement of Rome', 'Thomas à Kempis', 'Justin Martyr', 'John Chrysostom', 'Theodoret of Cyrus']) {
        same(cslName(name), { literal: name }, name);
      }
      same(cslName('Pseudo-Dionysius', 'Pseudo-Dionysius the Areopagite'), { literal: 'Pseudo-Dionysius the Areopagite' }, 'a sort form without a comma keeps the name whole');
    },
  },
  {
    name: 'settings.json is written with its keys in a fixed order, and missing settings take their defaults',
    fn() {
      const text = settingsToFileText({ views: [{ name: 'Office' }], currency: '€', dateStyle: 'CE' });
      same(Object.keys(JSON.parse(text)), Object.keys(SHARED_DEFAULTS));
      equal(JSON.parse(text).currency, '€');
      ok(text.endsWith('}\n'), 'a newline at the end');
      ok(!settingsToFileText({ syncKey: 'secret', theme: 'dark' }).includes('secret'), 'settings for one device, such as its sync key, are never written');
    },
  },
  {
    name: 'a device connected to one data repository and connecting to another is emptied first; a first connection, or the same repository in other capitals, is not',
    fn() {
      ok(isAnotherCatalog('JakobNath/my-loci-library-test-data', 'JakobNath/my-loci-library-data'), 'test catalog to real catalog');
      ok(!isAnotherCatalog('', 'JakobNath/my-loci-library-data'), 'never connected: its books are kept and sent');
      ok(!isAnotherCatalog(undefined, 'JakobNath/my-loci-library-data'), 'a device that has never saved a repository');
      ok(!isAnotherCatalog('JakobNath/my-loci-library-data', ' jakobnath/My-Loci-Library-Data '), 'same repository, other capitals and spaces');
    },
  },
  {
    name: 'trash: a book goes with its copies and its own works, a shared work stays, and restoring brings all back',
    fn() {
      const copy = (id, edition, values = {}) => newRecord('copy', id, NOW_TEST, { edition, added: '2026-11-10', ...values });
      const secondConfessions = { ...chadwick, id: 'c0nf2nded1tn' };
      const records = byId([plato, ...loebWorks, loeb36, augustine, confessions, chadwick, secondConfessions,
        copy('c0py0000000a', loeb36.id), copy('c0py0000000b', chadwick.id)]);
      const trashedLoeb = trashBook(records, loeb36.id, '2026-11-10', NOW_TEST);
      equal(trashedLoeb.filter(record => record.type === 'work').length, loebWorks.length, 'its works, used by no other edition');
      equal(trashedLoeb.filter(record => record.type !== 'work').length, 2, 'the edition and its copy');
      ok(trashedLoeb.every(record => record.trashed === '2026-11-10' && record.changed.trashed === NOW_TEST), 'each is dated, and the change is recorded for sync');
      const trashedChadwick = trashBook(records, chadwick.id, '2026-11-10', NOW_TEST);
      ok(!trashedChadwick.some(record => record.id === confessions.id), 'Confessions stays: another edition uses it');
      for (const record of trashedLoeb) records.set(record.id, record);
      equal(buildLibrary([...records.values()]).entries.some(entry => entry.id === loeb36.id), false, 'the library leaves it out');
      same(trashedItems(records).map(record => record.id), [loeb36.id]);
      const restored = restoreBook(records, loeb36.id, NOW_TEST);
      equal(restored.length, trashedLoeb.length);
      for (const record of restored) records.set(record.id, record);
      equal(buildLibrary([...records.values()]).entries.some(entry => entry.id === loeb36.id), true, 'back in the library');
      same(trashedItems(records), []);
    },
  },
  {
    name: 'a book no longer owned is left out of counts, shelf lists and value totals',
    fn() {
      const copy = (id, values) => newRecord('copy', id, NOW_TEST, { edition: chadwick.id, added: '2026-11-10', location: ['Home', 'Office'], value: 20, ...values });
      const library = buildLibrary([augustine, confessions, chadwick, copy('c0py0000000c', { status: 'given away' })]);
      const entry = library.entries[0];
      equal(entry.owned, false);
      equal(entry.value, 0, 'no value counted');
      same(viewEntries(library.entries, { location: ['Home', 'Office'] }), [], 'not on the shelf list');
      equal(viewEntries(library.entries, { status: 'gone' }).length, 1, 'still found when asked for');
    },
  },
  {
    name: 'managed lists: renaming a category, tag, binding or place edits every record using it, and renaming onto an existing name merges',
    fn() {
      const w = (id, category, tags) => newRecord('work', id, NOW_TEST, { title: id, category, tags });
      const c = (id, binding, location) => newRecord('copy', id, NOW_TEST, { edition: chadwick.id, added: '2026-11-10', binding, location });
      const records = [w('w0rk0000000a', 'Church Fathers', ['greek', 'Greek']), w('w0rk0000000b', 'Patristics', ['Greek']),
        c('c0py0000000d', 'Hardback', ['Home', 'Office', 'Case 1']), c('c0py0000000e', 'Hardcover', ['Home', 'Office', 'Case 2']), c('c0py0000000f', 'Paperback', ['Home', 'Bedroom'])];
      same(listValues(records, 'category').map(item => [item.value, item.count]), [['Church Fathers', 1], ['Patristics', 1]]);
      const merged = renameValue(records, 'category', 'Church Fathers', 'Patristics', NOW_TEST);
      equal(merged.length, 1);
      equal(merged[0].category, 'Patristics');
      equal(merged[0].changed.category, NOW_TEST, 'the change is stamped for sync');
      same(renameValue(records, 'tag', 'greek', 'Greek', NOW_TEST)[0].tags, ['Greek'], 'a merged tag appears once');
      same(renameValue(records, 'binding', 'Hardback', 'Hardcover', NOW_TEST).map(copy => copy.binding), ['Hardcover']);
      same(listValues(records, 'place').map(item => item.value.join(' › ')), ['Home', 'Home › Bedroom', 'Home › Office', 'Home › Office › Case 1', 'Home › Office › Case 2']);
      const moved = renameValue(records, 'place', ['Home', 'Office'], ['Home', 'Study'], NOW_TEST);
      same(moved.map(copy => copy.location), [['Home', 'Study', 'Case 1'], ['Home', 'Study', 'Case 2']], 'everything inside the room moves with it');
    },
  },
  {
    name: 'a version-1 edition reads, edits and saves as version 2, with nothing lost',
    fn() {
      // An edition file as the test catalog held it before November 2026.
      const stored = JSON.parse("{\n  \"format\": 1,\n  \"type\": \"edition\",\n  \"id\": \"2gebc2ep9fp2\",\n  \"title\": \"Confessions\",\n  \"subtitle\": null,\n  \"contents\": [\n    {\n      \"work\": \"6jwwbbrvgvdy\",\n      \"extent\": \"complete\",\n      \"translator\": null,\n      \"pages\": null\n    }\n  ],\n  \"contributors\": [\n    {\n      \"name\": \"Henry Chadwick\",\n      \"role\": \"translator\"\n    }\n  ],\n  \"publisher\": \"Oxford University Press\",\n  \"place\": \"Oxford\",\n  \"year\": 1991,\n  \"editionStatement\": null,\n  \"translationFirstPublished\": null,\n  \"series\": \"Oxford World's Classics\",\n  \"seriesNumber\": null,\n  \"set\": null,\n  \"volume\": null,\n  \"isbn\": \"9780199537822\",\n  \"languages\": [\n    \"English\"\n  ],\n  \"pages\": \"311\",\n  \"height\": null,\n  \"heightSource\": null,\n  \"thickness\": null,\n  \"thicknessSource\": null,\n  \"medium\": \"physical\",\n  \"logosId\": null,\n  \"logosExtra\": {},\n  \"cite\": false,\n  \"images\": [],\n  \"trashed\": null,\n  \"created\": \"2026-11-09T12:00:00Z\",\n  \"changed\": {}\n}");
      const read = migrate(stored);
      equal(stored.format, 1, 'the record read is not changed');
      equal(recordToFileText(stored), `${JSON.stringify(stored, null, 2)}\n`, 'a version-1 record is written exactly as stored, for comparing with its file');
      same([read.format, read.identifiers, read.subjects], [2, { lccn: null, oclc: null, lcc: null, ddc: null }, []]);
      for (const name of Object.keys(stored).filter(name => name !== 'format')) same(read[name], stored[name], name);
      const edited = withField(read, 'pages', 'xxviii, 311', '2026-11-12T09:00:00Z');
      same(validateRecord(edited), []);
      const text = recordToFileText(edited);
      ok(text.includes('"isbn": "9780199537822",\n  "identifiers": {\n    "lccn": null,'), 'the new fields sit in their fixed place');
      const saved = JSON.parse(text);
      for (const name of Object.keys(edited)) same(saved[name], edited[name], `saved ${name}`);
      same(migrate(read), read, 'a record already in this version stays as it is');
    },
  },
  {
    name: 'other version-1 records only change their format number, and a newer record is left alone',
    fn() {
      const work = { ...newRecord('work', 'c0nf3ss10n5x', NOW_TEST, { title: 'Confessions' }), format: 1 };
      same(migrate(work), { ...work, format: 2 });
      same(validateRecord(migrate(work)), []);
      const newer = { ...work, format: FORMAT_VERSION + 1, futureField: 'kept' };
      equal(migrate(newer), newer);
    },
  },
  {
    name: 'two devices merge a version-1 and a version-2 copy of one record field by field',
    fn() {
      const old = JSON.parse("{\"format\":1,\"type\":\"edition\",\"id\":\"2gebc2ep9fp2\",\"title\":\"Confessions\",\"subtitle\":null,\"contents\":[{\"work\":\"6jwwbbrvgvdy\",\"extent\":\"complete\",\"translator\":null,\"pages\":null}],\"contributors\":[{\"name\":\"Henry Chadwick\",\"role\":\"translator\"}],\"publisher\":\"Oxford University Press\",\"place\":\"Oxford\",\"year\":1991,\"editionStatement\":null,\"translationFirstPublished\":null,\"series\":\"Oxford World's Classics\",\"seriesNumber\":null,\"set\":null,\"volume\":null,\"isbn\":\"9780199537822\",\"languages\":[\"English\"],\"pages\":\"311\",\"height\":null,\"heightSource\":null,\"thickness\":null,\"thicknessSource\":null,\"medium\":\"physical\",\"logosId\":null,\"logosExtra\":{},\"cite\":false,\"images\":[],\"trashed\":null,\"created\":\"2026-11-09T12:00:00Z\",\"changed\":{}}");
      const theirs = withField(migrate(old), 'identifiers', { lccn: '2008491261', oclc: null, lcc: 'BR65.A6 E5 2008', ddc: null }, '2026-11-12T09:00:00Z');
      const mine = withField(migrate(old), 'pages', 'xxviii, 311', '2026-11-12T10:00:00Z');
      const merged = mergeRecords(mine, theirs);
      same([merged.format, merged.pages, merged.identifiers.lcc, merged.subjects], [2, 'xxviii, 311', 'BR65.A6 E5 2008', []]);
    },
  },
];
