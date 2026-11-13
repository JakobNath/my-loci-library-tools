// Records as plain JSON objects: their fields in the fixed order of
// DATA_FORMAT.md, making new ones, editing a field, and writing them as file
// text. Checking a record is in core/validate.js, which the app never loads. Core never reads the clock: "now" is passed in.


import { readBindingText } from './bindings.js';

export const FORMAT_VERSION = 4;

// The fields of each record type, in file order, with the value of an empty field.
export const FIELDS = {
  work: { title: '', subtitle: null, authors: [], originalTitle: null, otherTitles: [], originalLanguage: null, datings: [], sortYear: null, category: null, tags: [], wikidata: null },
  edition: {
    title: '', subtitle: null, contents: [], contributors: [], publisher: null, place: null, year: null,
    editionStatement: null, translationFirstPublished: null, series: null, seriesNumber: null, set: null, volume: null, setRecord: null,
    isbn: null, identifiers: { lccn: null, oclc: null, lcc: null, ddc: null, openLibrary: null, hathiTrust: null }, languages: [], subjects: [], foundContents: [], pages: null, height: null, heightSource: null, thickness: null, thicknessSource: null,
    medium: 'physical', logosId: null, logosExtra: {}, cite: false, images: [],
  },
  copy: {
    edition: '', binding: null, material: null, extras: [], location: [], shelfOrder: null, markings: false, added: '', acquired: null,
    price: null, value: null, valueHistory: [], notes: '', status: 'owned',
  },
  author: { name: '', otherNames: [], sortName: null },
  wishlist: { title: '', subtitle: null, authors: [], contributors: [], publisher: null, isbn: null, images: [], notes: '' },
  set: { title: '', shortTitle: null, editors: [], volumes: null, price: null, value: null, valueHistory: [], valueAsSet: false, notes: '' },
};

// Key order of the objects inside lists, so files always read the same.
const NESTED_ORDER = {
  datings: ['text', 'earliest', 'latest', 'certainty', 'kind', 'note', 'working'],
  contents: ['work', 'piece', 'extent', 'translator', 'pages', 'cite'],
  foundContents: ['author', 'title', 'extent'],
  contributors: ['name', 'role'],
  images: ['id', 'kind', 'source', 'color', 'ratio', 'master', 'waiting'],
  valueHistory: ['date', 'value'],
};
// A piece inside a book (a poem, hymn, sermon or letter), kept in its contents entry instead of as a work.
const PIECE_KEYS = ['title', 'author', 'originalTitle', 'date'];
// The same for an edition's catalogue numbers, which are one object, not a list.
export const IDENTIFIER_KEYS = ['lccn', 'oclc', 'lcc', 'ddc', 'openLibrary', 'hathiTrust'];
// What records of older versions hold, so their files are written exactly as stored.
const OLDER_KEYS = { 2: { contents: ['work', 'extent', 'translator', 'pages'], identifiers: ['lccn', 'oclc', 'lcc', 'ddc'] } };
OLDER_KEYS[1] = OLDER_KEYS[2];

export const STATUSES = ['owned', 'given away', 'sold', 'lost', 'gone from Logos'];
export const ROLES = ['translator', 'editor', 'introduction', 'illustrator', 'other'];

/**
 * A new record with every field present.
 * @param {string} type work, edition, copy, author, wishlist or set
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
 * An edition's entry for one image whose files have been made (DATA_FORMAT.md, "Images").
 * @param {string} id the image's own ID
 * @param {'cover'|'spine'|'contents'} kind
 * @param {string} source "photo" for ours, or the lookup it came from
 * @param {{ color?: string, ratio: number }} files from edges/photo.js
 * @param {boolean} hasMaster whether a master file was kept (our photos)
 */
export function imageEntry(id, kind, source, files, hasMaster) {
  return { id, kind, source, color: kind === 'cover' ? files.color : null, ratio: files.ratio, master: hasMaster, waiting: null };
}

/**
 * An edition's images with a new photo in place of every image of its kind,
 * as when a cover is taken again: a book shows one cover and one spine. A
 * cover goes first, since the first cover is the one shown. The old images'
 * files stay in the data repository.
 */
export function withNewImage(images, image) {
  const others = images.filter(other => other.kind !== image.kind);
  return image.kind === 'cover' ? [image, ...others] : [...others, image];
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
 * The text of a record's file: keys in the fixed order, two-space indents,
 * a newline at the end.
 */
export function recordToFileText(record) {
  const ordered = { format: record.format, type: record.type, id: record.id };
  for (const name of Object.keys(FIELDS[record.type])) ordered[name] = orderNested(name, record[name], record.format);
  ordered.trashed = record.trashed;
  ordered.created = record.created;
  ordered.changed = Object.fromEntries(Object.entries(record.changed).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify(ordered, null, 2) + '\n';
}

// A record of an older version is written with that version's keys only, so
// its text stays exactly as stored (sync compares it with the file); a field
// it lacks (undefined) is left out by JSON.stringify.
function orderNested(name, value, format = FORMAT_VERSION) {
  const older = OLDER_KEYS[format] || {};
  if (name === 'identifiers') return value && Object.fromEntries((older.identifiers || IDENTIFIER_KEYS).map(key => [key, value[key] ?? null]));
  const keys = older[name] || NESTED_ORDER[name];
  if (!keys || !Array.isArray(value)) return value;
  return value.map(item => {
    const ordered = {};
    for (const key of keys) ordered[key] = key === 'piece' ? orderPiece(item.piece) : key === 'cite' ? item.cite === true : item[key] ?? null;
    return ordered;
  });
}

const orderPiece = piece => (piece ? Object.fromEntries(PIECE_KEYS.map(key => [key, piece[key] ?? null])) : null);

/**
 * A record as this app's data format: older records are upgraded one
 * version at a time, and nothing in them is lost (DATA_FORMAT.md, "Format
 * versions"). A record newer than this app is returned unchanged; sync
 * refuses to write over it. Every place that reads records reads through this.
 * @param {object} record as read from a file, storage or catalog.json
 * @returns {object} a new object when anything changed
 */
export function migrate(record) {
  let upgraded = record;
  if (upgraded.format === 1) upgraded = fromVersion1(upgraded);
  if (upgraded.format === 2) upgraded = fromVersion2(upgraded);
  if (upgraded.format === 3) upgraded = fromVersion3(upgraded);
  return upgraded;
}

// Version 4 (November 2026) split a copy's binding into binding, material and
// extras, each from a list, and linked an edition to its set's own record.
function fromVersion3(record) {
  if (record.type === 'copy') return { ...record, format: 4, ...readBindingText(record.binding) };
  if (record.type === 'edition') return { ...record, format: 4, setRecord: null };
  return { ...record, format: 4 };
}

// Version 2 (November 2026) gave each edition its catalogue numbers and subject headings.
function fromVersion1(record) {
  if (record.type !== 'edition') return { ...record, format: 2 };
  return { ...record, format: 2, identifiers: { lccn: null, oclc: null, lcc: null, ddc: null }, subjects: [] };
}

// Version 3 (November 2026) gave each work its other titles and Wikidata ID,
// each edition two more outside IDs (Open Library, HathiTrust) and a place for
// contents found by the laptop, and each contents entry a piece (for a short
// work kept inside its book) and whether it is cited.
function fromVersion2(record) {
  if (record.type === 'work') return { ...record, format: 3, otherTitles: [], wikidata: null };
  if (record.type !== 'edition') return { ...record, format: 3 };
  return {
    ...record,
    format: 3,
    identifiers: { ...record.identifiers, openLibrary: null, hathiTrust: null },
    contents: record.contents.map(entry => ({ work: entry.work, piece: null, extent: entry.extent, translator: entry.translator, pages: entry.pages, cite: false })),
    foundContents: [],
  };
}
