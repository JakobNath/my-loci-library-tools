// Records, IDs, merging, shelf order, HTML escaping and the CSL mapping.

import { makeId, isId, ID_ALPHABET } from '../ids.js';
import { newRecord, withField, validateRecord, recordToFileText, FIELDS } from '../records.js';
import { mergeRecords } from '../merge.js';
import { keyBetween, keysForShelf } from '../shelf-order.js';
import { escapeHtml } from '../html.js';
import { editionToCsl, cslName } from '../zotero.js';
import { equal, same, ok, throws } from './check.js';
import { SHARED_DEFAULTS, settingsToFileText } from '../settings.js';
import { na28, na28Works, loeb36, loebWorks, plato, chadwick, confessions, augustine, byId } from './samples.js';

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
      ok(validateRecord({ ...chadwick, format: 2 }).some(p => p.includes('version 2')), 'newer format');
    },
  },
  {
    name: 'a file is pretty-printed with keys in order and a newline at the end',
    fn() {
      const text = recordToFileText(chadwick);
      ok(text.endsWith('}\n'), 'newline at the end');
      ok(text.startsWith('{\n  "format": 1,\n  "type": "edition",\n  "id": "chadw1ck1991",\n  "title"'), 'key order');
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
    name: 'an anthology gets its earliest date, and BC years stay negative (Loeb 36, #9)',
    fn() {
      const item = editionToCsl(loeb36, byId(loebWorks), byId([plato]));
      same(item['original-date'], { 'date-parts': [[-399]] });
      equal(item['collection-number'], '36');
      same(cslName('Martin Chemnitz', 'Chemnitz, Martin'), { family: 'Chemnitz', given: 'Martin' });
    },
  },
  {
    name: 'settings.json is written with its keys in a fixed order, and missing settings take their defaults',
    fn() {
      const text = settingsToFileText({ views: [{ name: 'Office' }], currency: '€', dateStyle: 'CE' });
      same(Object.keys(JSON.parse(text)), Object.keys(SHARED_DEFAULTS));
      equal(JSON.parse(text).currency, '€');
      ok(text.endsWith('}\n'), 'a newline at the end');
    },
  },
];
