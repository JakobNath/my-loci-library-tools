// Records, IDs, merging, shelf order, HTML escaping and the CSL mapping.

import { makeId, isId, ID_ALPHABET } from '../ids.js';
import { newRecord, withField, recordToFileText, FIELDS, migrate, FORMAT_VERSION, imageEntry, withNewImage } from '../records.js';
import { validateRecord } from '../validate.js';
import { mergeRecords } from '../merge.js';
import { keyBetween, keysForShelf, keysAfterMove } from '../shelf-order.js';
import { escapeHtml } from '../html.js';
import { editionToCsl, cslName, volumeOfSet, editionForCitation, originalDateOf } from '../zotero.js';
import { parseDating } from '../dating.js';
import { equal, same, ok, throws } from './check.js';
import { SHARED_DEFAULTS, withDefaults, settingsToFileText, isAnotherCatalog, setupLink, readSetupLink, guessDataRepo } from '../settings.js';
import { readBindingText, bindingText, sortBindingList } from '../bindings.js';
import { trashBook, restoreBook, trashedItems } from '../trash.js';
import { listValues, renameValue } from '../lists.js';
import { buildLibrary, viewEntries } from '../library.js';
import { na28, na28Works, loeb36, loebWorks, plato, chadwick, confessions, augustine, byId } from './samples.js';

const NOW_TEST = '2026-11-10T12:00:00Z';
const FIELDS_IMAGE = ['id', 'kind', 'source', 'color', 'ratio', 'master', 'waiting'];

const T1 = '2026-11-09T10:00:00Z';
const T2 = '2026-11-09T11:00:00Z';

export const tests = [
  {
    name: 'a new cover photo replaces the old covers and goes first; a new spine photo replaces the old spine',
    fn() {
      const cover = imageEntry('c0verphoto01', 'cover', 'photo', { color: '#223344', ratio: 0.66 }, true);
      same(Object.keys(cover), FIELDS_IMAGE, 'the fields of an image, in order');
      equal(cover.color, '#223344');
      const spine = imageEntry('sp1nephoto01', 'spine', 'photo', { color: '#000000', ratio: 0.1 }, true);
      equal(spine.color, null, 'only a cover keeps its color');
      const old = [{ id: 'oldcover0001', kind: 'cover' }, { id: 'oldspine0001', kind: 'spine' }, { id: 'contents0001', kind: 'contents' }];
      same(withNewImage(old, cover).map(image => image.id), ['c0verphoto01', 'oldspine0001', 'contents0001']);
      same(withNewImage(old, spine).map(image => image.id), ['oldcover0001', 'contents0001', 'sp1nephoto01']);
    },
  },
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
      ok(validateRecord({ ...chadwick, format: FORMAT_VERSION + 1 }).some(p => p.includes(`version ${FORMAT_VERSION + 1}`)), 'newer format');
    },
  },
  {
    name: 'a file is pretty-printed with keys in order and a newline at the end',
    fn() {
      const text = recordToFileText(chadwick);
      ok(text.endsWith('}\n'), 'newline at the end');
      ok(text.startsWith(`{\n  "format": ${FORMAT_VERSION},\n  "type": "edition",\n  "id": "chadw1ck1991",\n  "title"`), 'key order');
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
    name: 'moving a copy along a shelf changes only its own key',
    fn() {
      const keys = ['b', 'd', 'f', 'h'];
      const moved = keysAfterMove(keys, 3, 1); // the last copy goes between the first two
      same([...moved.keys()], [3]);
      ok('b' < moved.get(3) && moved.get(3) < 'd', 'between its new neighbours');
      ok(keysAfterMove(keys, 0, 4).get(0) > 'h', 'to the end');
      ok(keysAfterMove(keys, 2, 0).get(2) < 'b', 'to the start');
      equal(keysAfterMove(keys, 1, 1).size, 0, 'its own gap: nothing changes');
      equal(keysAfterMove(keys, 1, 2).size, 0, 'the gap just after it: nothing changes');
    },
  },
  {
    name: 'a shelf with missing or repeated keys is renumbered once in its new order',
    fn() {
      for (const keys of [['b', null, null], ['b', 'b', 'd']]) {
        const moved = keysAfterMove(keys, 2, 0);
        const result = keys.map((key, i) => (moved.has(i) ? moved.get(i) : key));
        const order = [2, 0, 1].map(i => result[i]);
        same([...order].sort(), order, `${keys.join(',')}: sorted in the new order`);
        equal(new Set(result).size, 3, 'every key different');
      }
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
      same(item['original-date'], { 'date-parts': [[397], [400]], circa: true }, 'c. 397–400, not "397"');
      equal(item['collection-title'], "Oxford World's Classics");
    },
  },
  {
    name: 'an original date says no more than its dating: a year, a span, circa, or nothing for a century',
    fn() {
      const original = text => originalDateOf({ datings: [{ ...parseDating(text).dating, working: true }] });
      same(original('1689'), { 'date-parts': [[1689]] });
      same(original('385 BC'), { 'date-parts': [[-385]] });
      same(original('1530–59'), { 'date-parts': [[1530], [1559]] });
      same(original('c. 397'), { 'date-parts': [[397]], circa: true });
      equal(original('early 2nd c.'), null, 'not "orig. 101"');
      equal(original('after 1517'), null);
      equal(originalDateOf({ datings: [] }), null);
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
    name: 'a setup link carries the catalog and both keys after the "#", and reads back the same',
    fn() {
      const link = setupLink('https://jakobnath.github.io/my-loci-library/', { repo: 'JakobNath/my-loci-library-data', key: 'github_pat_a+b/c', googleBooksKey: 'AIza1' });
      ok(link.startsWith('https://jakobnath.github.io/my-loci-library/#/connect?'), 'everything after the "#"');
      same(readSetupLink(link.slice(link.indexOf('#'))), { repo: 'JakobNath/my-loci-library-data', key: 'github_pat_a+b/c', googleBooksKey: 'AIza1' });
      equal(readSetupLink('#' + setupLink('x', { repo: 'a/b', key: 'k' }).split('#')[1]).googleBooksKey, '', 'no Google Books key');
      equal(readSetupLink('#/settings/advanced'), null, 'an ordinary address');
      equal(readSetupLink('#/connect?repo=a/b'), null, 'a link without a key');
    },
  },
  {
    name: 'the data repository is guessed from a github.io address, and not elsewhere',
    fn() {
      equal(guessDataRepo('jakobnath.github.io'), 'jakobnath/my-loci-library-data');
      equal(guessDataRepo('localhost'), '');
      equal(guessDataRepo('books.example.org'), '');
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
    name: 'a version-1 edition reads, edits and saves as the current version, with nothing lost',
    fn() {
      // An edition file as the test catalog held it before November 2026.
      const stored = JSON.parse("{\n  \"format\": 1,\n  \"type\": \"edition\",\n  \"id\": \"2gebc2ep9fp2\",\n  \"title\": \"Confessions\",\n  \"subtitle\": null,\n  \"contents\": [\n    {\n      \"work\": \"6jwwbbrvgvdy\",\n      \"extent\": \"complete\",\n      \"translator\": null,\n      \"pages\": null\n    }\n  ],\n  \"contributors\": [\n    {\n      \"name\": \"Henry Chadwick\",\n      \"role\": \"translator\"\n    }\n  ],\n  \"publisher\": \"Oxford University Press\",\n  \"place\": \"Oxford\",\n  \"year\": 1991,\n  \"editionStatement\": null,\n  \"translationFirstPublished\": null,\n  \"series\": \"Oxford World's Classics\",\n  \"seriesNumber\": null,\n  \"set\": null,\n  \"volume\": null,\n  \"isbn\": \"9780199537822\",\n  \"languages\": [\n    \"English\"\n  ],\n  \"pages\": \"311\",\n  \"height\": null,\n  \"heightSource\": null,\n  \"thickness\": null,\n  \"thicknessSource\": null,\n  \"medium\": \"physical\",\n  \"logosId\": null,\n  \"logosExtra\": {},\n  \"cite\": false,\n  \"images\": [],\n  \"trashed\": null,\n  \"created\": \"2026-11-09T12:00:00Z\",\n  \"changed\": {}\n}");
      const read = migrate(stored);
      equal(stored.format, 1, 'the record read is not changed');
      equal(recordToFileText(stored), `${JSON.stringify(stored, null, 2)}\n`, 'a version-1 record is written exactly as stored, for comparing with its file');
      same([read.format, read.identifiers, read.subjects, read.foundContents], [FORMAT_VERSION, { lccn: null, oclc: null, lcc: null, ddc: null, openLibrary: null, hathiTrust: null }, [], []]);
      same(read.contents, [{ work: '6jwwbbrvgvdy', piece: null, extent: 'complete', translator: null, pages: null, cite: false }], 'each contents entry gains no piece and is not cited');
      for (const name of Object.keys(stored).filter(name => !['format', 'contents'].includes(name))) same(read[name], stored[name], name);
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
      same(migrate(work), { ...work, format: FORMAT_VERSION });
      same(validateRecord(migrate(work)), []);
      const newer = { ...work, format: FORMAT_VERSION + 1, futureField: 'kept' };
      equal(migrate(newer), newer);
    },
  },
  {
    name: 'two devices merge a version-1 and a current copy of one record field by field',
    fn() {
      const old = JSON.parse("{\"format\":1,\"type\":\"edition\",\"id\":\"2gebc2ep9fp2\",\"title\":\"Confessions\",\"subtitle\":null,\"contents\":[{\"work\":\"6jwwbbrvgvdy\",\"extent\":\"complete\",\"translator\":null,\"pages\":null}],\"contributors\":[{\"name\":\"Henry Chadwick\",\"role\":\"translator\"}],\"publisher\":\"Oxford University Press\",\"place\":\"Oxford\",\"year\":1991,\"editionStatement\":null,\"translationFirstPublished\":null,\"series\":\"Oxford World's Classics\",\"seriesNumber\":null,\"set\":null,\"volume\":null,\"isbn\":\"9780199537822\",\"languages\":[\"English\"],\"pages\":\"311\",\"height\":null,\"heightSource\":null,\"thickness\":null,\"thicknessSource\":null,\"medium\":\"physical\",\"logosId\":null,\"logosExtra\":{},\"cite\":false,\"images\":[],\"trashed\":null,\"created\":\"2026-11-09T12:00:00Z\",\"changed\":{}}");
      const theirs = withField(migrate(old), 'identifiers', { lccn: '2008491261', oclc: null, lcc: 'BR65.A6 E5 2008', ddc: null }, '2026-11-12T09:00:00Z');
      const mine = withField(migrate(old), 'pages', 'xxviii, 311', '2026-11-12T10:00:00Z');
      const merged = mergeRecords(mine, theirs);
      same([merged.format, merged.pages, merged.identifiers.lcc, merged.subjects], [FORMAT_VERSION, 'xxviii, 311', 'BR65.A6 E5 2008', []]);
    },
  },
  {
    name: 'a version-2 work, edition and contents read as version 3, and are written exactly as stored until edited',
    fn() {
      const work = { ...newRecord('work', 'c0nf3ss10n5x', NOW_TEST, { title: 'Confessions' }), format: 2 };
      delete work.otherTitles;
      delete work.wikidata;
      equal(recordToFileText(work), `${JSON.stringify(work, null, 2)}\n`, 'a version-2 work, as stored');
      same([migrate(work).format, migrate(work).otherTitles, migrate(work).wikidata], [FORMAT_VERSION, [], null]);
      const edition = { ...newRecord('edition', 'chadw1ck1991', NOW_TEST, { title: 'Confessions', contents: [{ work: 'c0nf3ss10n5x', extent: 'complete', translator: null, pages: null }] }), format: 2, identifiers: { lccn: null, oclc: null, lcc: null, ddc: null } };
      delete edition.foundContents;
      equal(recordToFileText(edition), `${JSON.stringify(edition, null, 2)}\n`, 'a version-2 edition, as stored');
      const read = migrate(edition);
      same(validateRecord(read), []);
      ok(recordToFileText(read).includes('"piece": null,'), 'written as version 3 once read');
    },
  },
  {
    name: 'a piece inside a book is a contents entry with no work; it needs a title',
    fn() {
      const piece = { work: null, piece: { title: 'The Raven', author: 'Edgar Allan Poe', originalTitle: null, date: '1845' }, extent: 'complete', translator: null, pages: '81–86', cite: false };
      const poe = newRecord('edition', 'p0etryta1es1', NOW_TEST, { title: 'Poetry and Tales', contents: [{ work: 'c0nf3ss10n5x', extent: 'complete', translator: null, pages: null, piece: null, cite: false }, piece] });
      same(validateRecord(poe), []);
      ok(recordToFileText(poe).includes('"title": "The Raven",\n        "author": "Edgar Allan Poe",'), 'the piece keeps its keys in order');
      ok(validateRecord({ ...poe, contents: [{ ...piece, piece: { ...piece.piece, title: '' } }] }).length > 0, 'a piece without a title');
      ok(validateRecord({ ...poe, foundContents: [{ author: null, title: '', extent: null }] }).length > 0, 'found contents need titles');
    },
  },
  {
    name: 'older binding text is read into binding, material and extras: the five texts of the real catalog in November 2026',
    fn() {
      const read = text => { const parts = readBindingText(text); return [parts.binding, parts.material, parts.extras]; };
      same(read('Hardcover with dust jacket'), ['Hardcover', null, ['Dust jacket']]);
      same(read('Hardcover'), ['Hardcover', null, []]);
      same(read('Paperback'), ['Paperback', null, []]);
      same(read('Cloth'), [null, 'Cloth', []]);
      same(read('Cloth and hardcover in slip case'), ['Hardcover', 'Cloth', ['Slipcase']]);
    },
  },
  {
    name: 'binding text that cannot be read wholly is kept as it was, never guessed at',
    fn() {
      const read = text => { const parts = readBindingText(text); return [parts.binding, parts.material, parts.extras]; };
      same(read('Mass-market paperback'), ['Mass-market paperback', null, []], 'not read as plain paperback');
      same(read('Bonded leather'), [null, 'Bonded leather', []], 'not read as leather');
      same(read('Hardcover, Smyth-sewn'), ['Hardcover, Smyth-sewn', null, []], 'a word left over');
      same(read('Hardcover and paperback'), ['Hardcover and paperback', null, []], 'two bindings at once');
      same(read(null), [null, null, []]);
      same(read(''), [null, null, []]);
      equal(bindingText({ binding: 'Hardcover', material: 'Cloth', extras: ['Dust jacket', 'Slipcase'] }), 'Hardcover · Cloth · Dust jacket · Slipcase');
      equal(bindingText({ binding: null, material: null, extras: [] }), '');
    },
  },
  {
    name: 'a version-3 copy reads as version 4 with its binding in parts, and is written exactly as stored until edited',
    fn() {
      const copy = { ...newRecord('copy', 'c0pyna280001', NOW_TEST, { edition: na28.id, added: '2026-11-09', binding: 'Hardcover with dust jacket' }), format: 3 };
      delete copy.material;
      delete copy.extras;
      equal(recordToFileText(copy), `${JSON.stringify(copy, null, 2)}\n`, 'a version-3 copy, as stored');
      const read = migrate(copy);
      same([read.format, read.binding, read.material, read.extras], [4, 'Hardcover', null, ['Dust jacket']]);
      same(validateRecord(read), []);
      ok(recordToFileText(read).includes('"binding": "Hardcover",\n  "material": null,\n  "extras": [\n    "Dust jacket"\n  ],\n  "location"'), 'the new fields sit after the binding');
      equal(copy.binding, 'Hardcover with dust jacket', 'the record read is not changed');
    },
  },
  {
    name: 'a version-3 edition gains no set record, and other records only change their format number',
    fn() {
      const edition = { ...chadwick, format: 3 };
      delete edition.setRecord;
      same([migrate(edition).format, migrate(edition).setRecord], [4, null]);
      same(validateRecord(migrate(edition)), []);
      same(migrate({ ...augustine, format: 3 }), augustine);
      ok(validateRecord({ ...chadwick, setRecord: 'Luther\'s Works' }).some(p => p.includes('setRecord')), 'a link holds an ID, not a title');
    },
  },
  {
    name: 'a set record holds its title, short form, editors, volumes, price, value and the switch to count one value for the whole set',
    fn() {
      const set = newRecord('set', 'setw0rks0001', NOW_TEST, { title: 'Luther\'s Works', shortTitle: 'LW', editors: ['Jaroslav Pelikan', 'Helmut T. Lehmann'], volumes: 55, price: 900, value: 1200 });
      same(Object.keys(set), ['format', 'type', 'id', 'title', 'shortTitle', 'editors', 'volumes', 'price', 'value', 'valueHistory', 'valueAsSet', 'notes', 'trashed', 'created', 'changed']);
      same(validateRecord(set), []);
      equal(set.valueAsSet, false, 'each volume counts its own value until the switch is turned on');
      ok(validateRecord({ ...set, title: '' }).some(p => p.includes('needs a title')));
      ok(validateRecord({ ...set, volumes: 'fifty-five' }).some(p => p.includes('volumes')));
      ok(validateRecord({ ...set, valueAsSet: 'yes' }).some(p => p.includes('true or false')));
      ok(recordToFileText(withField(set, 'valueHistory', [{ value: 1200, date: '2026-11-12' }], NOW_TEST)).includes('"date": "2026-11-12",\n      "value": 1200'), 'value history keeps its key order');
    },
  },
  {
    name: 'an older settings.json, with one mixed bindings list, is read as three lists',
    fn() {
      // The real catalog's list in November 2026.
      const old = { bindings: ['Hardcover', 'Hardcover with dust jacket', 'Paperback', 'Mass-market paperback', 'Leather', 'Bonded leather', 'Cloth', 'Library binding', 'Journal issue'] };
      const read = withDefaults(old);
      same(read.bindings, ['Hardcover', 'Paperback', 'Mass-market paperback', 'Library binding', 'Journal issue']);
      same(read.materials, ['Leather', 'Bonded leather', 'Cloth']);
      same(read.extras, ['Dust jacket', 'Slipcase'], 'the default extras are added');
      same(withDefaults({ bindings: ['Hardcover'], materials: ['Vellum'], extras: [] }).materials, ['Vellum'], 'settings already in three lists are kept as they are');
      same(withDefaults({}).bindings, SHARED_DEFAULTS.bindings);
      same(sortBindingList(['Hardcover, Smyth-sewn']).bindings, ['Hardcover, Smyth-sewn'], 'an entry that cannot be read stays a binding');
    },
  },
];
