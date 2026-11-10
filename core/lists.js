// Managed lists (PLAN.md, "Settings": "Lists"): the categories, tags, series,
// bindings and places in use, and renaming one, which edits every record that
// uses it. Renaming to a name already in use merges the two. These values live
// only on the records (DATA_FORMAT.md, "settings.json"), apart from the
// binding choices, which the shared settings also list.

import { withField } from './records.js';

// For each list: which records hold it, how to read its values from one, and
// how to give a record a renamed value. A place is a path (["Home", "Office"]),
// and renaming it renames that part of every path inside it too.
const LISTS = {
  category: { type: 'work', field: 'category', values: work => (work.category ? [work.category] : []), rename: (work, from, to) => (work.category === from ? to : work.category) },
  tag: { type: 'work', field: 'tags', values: work => work.tags, rename: (work, from, to) => [...new Set(work.tags.map(tag => (tag === from ? to : tag)))] },
  series: { type: 'edition', field: 'series', values: edition => (edition.series ? [edition.series] : []), rename: (edition, from, to) => (edition.series === from ? to : edition.series) },
  binding: { type: 'copy', field: 'binding', values: copy => (copy.binding ? [copy.binding] : []), rename: (copy, from, to) => (copy.binding === from ? to : copy.binding) },
  place: {
    type: 'copy',
    field: 'location',
    values: copy => copy.location.map((part, i) => copy.location.slice(0, i + 1)).filter(path => path[path.length - 1]),
    rename: (copy, from, to) => (from.every((part, i) => copy.location[i] === part) ? [...to, ...copy.location.slice(from.length)] : copy.location),
  },
};
export const LIST_KINDS = Object.keys(LISTS);

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every value of a list in use, with how many records use it, in order.
 * Records in the trash are not counted.
 * @param {Iterable<object>} records
 * @param {string} kind one of LIST_KINDS
 * @returns {{ value: string|string[], count: number }[]}
 */
export function listValues(records, kind) {
  const list = LISTS[kind];
  const counts = new Map();
  for (const record of records) {
    if (record.type !== list.type || record.trashed) continue;
    for (const value of list.values(record)) {
      const key = JSON.stringify(value);
      counts.set(key, { value, count: (counts.get(key)?.count || 0) + 1 });
    }
  }
  const text = value => (Array.isArray(value) ? value.join(' › ') : value);
  return [...counts.values()].sort((a, b) => text(a.value).localeCompare(text(b.value)));
}

/**
 * Rename a value everywhere it is used (and so merge it, when `to` is already in use).
 * @param {Iterable<object>} records every record, including those in the trash
 * @param {string} kind one of LIST_KINDS
 * @param {string|string[]} from the value now; a place is a path
 * @param {string|string[]} to the new value
 * @returns {object[]} the changed records, to save
 */
export function renameValue(records, kind, from, to, now) {
  const list = LISTS[kind];
  const changed = [];
  for (const record of records) {
    if (record.type !== list.type) continue;
    const value = list.rename(record, from, to);
    if (!sameValue(value, record[list.field])) changed.push(withField(record, list.field, value, now));
  }
  return changed;
}
