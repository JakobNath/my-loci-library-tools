// A set's own record (DATA_FORMAT.md, "Set"; data format 4): making one from
// its small form, linking the editions of that set to it, keeping their set
// title in step when the set is renamed, and listing its volumes, held and
// missing. Each edition keeps its `set` text as printed and points to the
// record with `setRecord` (docs/decisions/data-format.md, 2026-11-12).

import { newRecord, withField } from './records.js';
import { normalizeForSearch } from './search.js';

// Change a record field by field, stamping only what differs (as core/entry.js does).
function update(record, values, now) {
  let result = record;
  for (const [name, value] of Object.entries(values)) {
    if (JSON.stringify(result[name]) !== JSON.stringify(value)) result = withField(result, name, value, now);
  }
  return result;
}

const amount = text => (String(text ?? '').trim() === '' ? null : Number(text));

/**
 * A set record from its form: new, or the existing one with only what changed
 * stamped. A changed value is added to the value history, one per day.
 * @param {{ title: string, shortTitle?: string, editors?: string, volumes?: string, price?: string, value?: string, valueAsSet?: boolean, notes?: string }} form
 *   editors: names separated by ";"
 * @param {object|null} existing
 * @returns {{ record: object|null, problems: string[] }}
 */
export function setFromForm(form, existing, { newId, now, today }) {
  const text = value => String(value ?? '').trim();
  const problems = [];
  if (!text(form.title)) problems.push('A set needs a title.');
  const volumes = amount(form.volumes);
  if (volumes !== null && !(Number.isInteger(volumes) && volumes > 0)) problems.push('The number of volumes should be a whole number, such as 55.');
  for (const name of ['price', 'value']) if (Number.isNaN(amount(form[name]))) problems.push(`The ${name} should be a number, such as 450.`);
  if (problems.length) return { record: null, problems };
  const value = amount(form.value);
  let history = existing ? existing.valueHistory : [];
  if (value !== null && (!existing || existing.value !== value)) history = [...history.filter(point => point.date !== today), { date: today, value }];
  const values = {
    title: text(form.title), shortTitle: text(form.shortTitle) || null,
    editors: text(form.editors).split(';').map(name => name.trim()).filter(Boolean),
    volumes, price: amount(form.price), value, valueHistory: history, valueAsSet: Boolean(form.valueAsSet), notes: text(form.notes),
  };
  return { record: existing ? update(existing, values, now) : newRecord('set', newId(), now, values), problems: [] };
}

/**
 * The editions that belong to a set: those linked to it, and those whose set
 * title is the same (ignoring capitals and accents) and are linked to no other
 * set. These are the ones "Add the set's details" links.
 * @param {Iterable<object>} editions
 * @param {object} set the set record
 * @returns {object[]}
 */
export function editionsOfSet(editions, set) {
  const title = normalizeForSearch(set.title);
  return [...editions].filter(edition => !edition.trashed && (edition.setRecord === set.id
    || (!edition.setRecord && edition.set && normalizeForSearch(edition.set) === title)));
}

/**
 * The editions changed so that each points to the set and carries its title
 * as its set text (so renaming a set renames it on every volume).
 * @returns {object[]} only the editions that changed, to save
 */
export function linkEditionsToSet(editions, set, now) {
  return editions.map(edition => update(edition, { setRecord: set.id, set: set.title }, now)).filter((edition, i) => edition !== editions[i]);
}

/**
 * The volumes of a set, in order of their label, and the volume numbers not
 * held when the set's size is known and its labels are plain numbers.
 * @param {object[]} entries the library's entries
 * @param {object} set
 * @returns {{ held: object[], missing: string[] }} held: entries; missing: labels such as "56"
 */
export function volumesOfSet(entries, set) {
  const held = entries.filter(entry => entry.edition.setRecord === set.id);
  const label = entry => String(entry.edition.volume || '');
  held.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }) || a.edition.title.localeCompare(b.edition.title));
  const labels = new Set(held.map(label));
  const numbered = held.every(entry => /^\d+$/.test(label(entry)));
  const missing = [];
  if (set.volumes && numbered) for (let n = 1; n <= set.volumes; n++) if (!labels.has(String(n))) missing.push(String(n));
  return { held, missing };
}
