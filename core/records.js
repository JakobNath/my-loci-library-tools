// Records as plain JSON objects: their fields in the fixed order of
// DATA_FORMAT.md, making new ones, editing a field, checking them, and
// writing them as file text. Core never reads the clock: "now" is passed in.

import { isId } from './ids.js';

export const FORMAT_VERSION = 1;

// The fields of each record type, in file order, with the value of an empty field.
export const FIELDS = {
  work: { title: '', subtitle: null, authors: [], originalTitle: null, originalLanguage: null, datings: [], sortYear: null, category: null, tags: [] },
  edition: {
    title: '', subtitle: null, contents: [], contributors: [], publisher: null, place: null, year: null,
    editionStatement: null, translationFirstPublished: null, series: null, seriesNumber: null, set: null, volume: null,
    isbn: null, languages: [], pages: null, height: null, heightSource: null, thickness: null, thicknessSource: null,
    medium: 'physical', logosId: null, logosExtra: {}, cite: false, images: [],
  },
  copy: {
    edition: '', binding: null, location: [], shelfOrder: null, markings: false, added: '', acquired: null,
    price: null, value: null, valueHistory: [], notes: '', status: 'owned',
  },
  author: { name: '', otherNames: [], sortName: null },
  wishlist: { title: '', subtitle: null, authors: [], contributors: [], publisher: null, isbn: null, images: [], notes: '' },
};

// Key order of the objects inside lists, so files always read the same.
const NESTED_ORDER = {
  datings: ['text', 'earliest', 'latest', 'certainty', 'kind', 'note', 'working'],
  contents: ['work', 'extent', 'translator', 'pages'],
  contributors: ['name', 'role'],
  images: ['id', 'kind', 'source', 'color', 'master'],
  valueHistory: ['date', 'value'],
};

export const STATUSES = ['owned', 'given away', 'sold', 'lost', 'gone from Logos'];
export const ROLES = ['translator', 'editor', 'introduction', 'illustrator', 'other'];
const SOURCES = { heightSource: ['measured', 'catalog'], thicknessSource: ['measured', 'catalog', 'photo'] };

/**
 * A new record with every field present.
 * @param {string} type work, edition, copy, author or wishlist
 * @param {string} id from makeId
 * @param {string} now the current moment, "YYYY-MM-DDTHH:MM:SSZ"
 * @param {object} [values] fields to fill in
 */
export function newRecord(type, id, now, values = {}) {
  if (!FIELDS[type]) throw new Error(`Unknown record type "${type}". Expected one of: ${Object.keys(FIELDS).join(', ')}.`);
  const record = { format: FORMAT_VERSION, type, id };
  for (const [name, empty] of Object.entries(FIELDS[type])) {
    record[name] = name in values ? values[name] : JSON.parse(JSON.stringify(empty));
  }
  record.trashed = values.trashed ?? null;
  record.created = now;
  record.changed = {};
  return record;
}

/**
 * The record with one field changed, stamped with the moment of the change
 * for merging. The original record is not modified.
 */
export function withField(record, name, value, now) {
  if (!(name in record) || ['format', 'type', 'id', 'created', 'changed'].includes(name)) {
    throw new Error(`"${name}" is not an editable field of a ${record.type}.`);
  }
  return { ...record, [name]: value, changed: { ...record.changed, [name]: now } };
}

/**
 * Check a record against DATA_FORMAT.md.
 * @returns {string[]} problems, in plain words; empty when the record is valid
 */
export function validateRecord(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['The record is not an object.'];
  if (record.format !== FORMAT_VERSION) problems.push(`This record is format version ${record.format}; this app reads format version ${FORMAT_VERSION}. Refresh the app before editing.`);
  const fields = FIELDS[record.type];
  if (!fields) return [...problems, `Unknown record type "${record.type}".`];
  if (!isId(record.id)) problems.push(`"${record.id}" is not a valid ID.`);
  for (const [name, empty] of Object.entries(fields)) {
    if (!(name in record)) { problems.push(`Missing field "${name}".`); continue; }
    const value = record[name];
    if (Array.isArray(empty) && !Array.isArray(value)) problems.push(`"${name}" should be a list.`);
    if (typeof empty === 'boolean' && typeof value !== 'boolean') problems.push(`"${name}" should be true or false.`);
  }
  if (typeof record.created !== 'string') problems.push('Missing "created".');
  if (!record.changed || typeof record.changed !== 'object') problems.push('Missing "changed".');
  problems.push(...TYPE_CHECKS[record.type](record));
  return problems;
}

const TYPE_CHECKS = {
  work(work) {
    const problems = [];
    if (!work.title) problems.push('A work needs a title.');
    if (work.datings.length && work.datings.filter(dating => dating.working).length !== 1) {
      problems.push('Exactly one dating must be the working dating.');
    }
    for (const dating of work.datings) {
      if (dating.earliest !== null && dating.latest !== null && dating.earliest > dating.latest) {
        problems.push(`Dating "${dating.text}" ends before it starts.`);
      }
      if (dating.earliest === 0 || dating.latest === 0) problems.push(`Dating "${dating.text}" uses year 0, which does not exist.`);
    }
    return problems;
  },
  edition(edition) {
    const problems = [];
    if (!edition.title) problems.push('An edition needs a title.');
    if (!edition.contents.length) problems.push('An edition needs at least one work in its contents.');
    for (const entry of edition.contents) if (!isId(entry.work)) problems.push(`Contents entry "${entry.work}" is not a work ID.`);
    if (!['physical', 'logos'].includes(edition.medium)) problems.push(`Medium "${edition.medium}" should be physical or logos.`);
    for (const contributor of edition.contributors) {
      if (!ROLES.includes(contributor.role)) problems.push(`Contributor role "${contributor.role}" is not one of: ${ROLES.join(', ')}.`);
    }
    for (const [field, allowed] of Object.entries(SOURCES)) {
      if (edition[field] !== null && !allowed.includes(edition[field])) problems.push(`${field} "${edition[field]}" is not one of: ${allowed.join(', ')}.`);
    }
    if (edition.isbn !== null && !/^\d{13}$/.test(edition.isbn)) problems.push(`ISBN "${edition.isbn}" should be 13 digits.`);
    return problems;
  },
  copy(copy) {
    const problems = [];
    if (!isId(copy.edition)) problems.push('A copy needs the ID of its edition.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(copy.added)) problems.push('"added" should be a date, YYYY-MM-DD.');
    if (!STATUSES.includes(copy.status)) problems.push(`Status "${copy.status}" is not one of: ${STATUSES.join(', ')}.`);
    if (copy.location.length > 4) problems.push('A location has at most four parts: place, room, case, shelf.');
    return problems;
  },
  author(author) {
    return author.name ? [] : ['An author needs a name.'];
  },
  wishlist(item) {
    return item.title ? [] : ['A wishlist item needs a title.'];
  },
};

/**
 * The text of a record's file: keys in the fixed order, two-space indents,
 * a newline at the end.
 */
export function recordToFileText(record) {
  const ordered = { format: record.format, type: record.type, id: record.id };
  for (const name of Object.keys(FIELDS[record.type])) ordered[name] = orderNested(name, record[name]);
  ordered.trashed = record.trashed;
  ordered.created = record.created;
  ordered.changed = Object.fromEntries(Object.entries(record.changed).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify(ordered, null, 2) + '\n';
}

function orderNested(name, value) {
  const keys = NESTED_ORDER[name];
  if (!keys || !Array.isArray(value)) return value;
  return value.map(item => {
    const ordered = {};
    for (const key of keys) ordered[key] = item[key] ?? null;
    return ordered;
  });
}
