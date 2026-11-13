// Checking a record against DATA_FORMAT.md, in plain words. Used by the
// tests and the laptop tools; the app itself never loads it (records come
// from its own forms, or through migrate in core/records.js), which keeps
// the code a phone loads at start small.

import { isId } from './ids.js';
import { FIELDS, FORMAT_VERSION, IDENTIFIER_KEYS, ROLES, STATUSES } from './records.js';

const SOURCES = { heightSource: ['measured', 'catalog'], thicknessSource: ['measured', 'catalog', 'photo'] };

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
    for (const entry of edition.contents) {
      const isPiece = entry.work === null && entry.piece && typeof entry.piece.title === 'string' && entry.piece.title;
      if (!isPiece && !isId(entry.work)) problems.push(`Contents entry "${entry.work}" is neither a work ID nor a piece with a title.`);
      if (entry.cite !== undefined && typeof entry.cite !== 'boolean') problems.push(`Contents entry "${entry.work || entry.piece.title}" should say whether it is cited (true or false).`);
    }
    if (edition.foundContents.some(entry => !entry || !entry.title)) problems.push('Every entry of "foundContents" needs a title.');
    if (!['physical', 'logos'].includes(edition.medium)) problems.push(`Medium "${edition.medium}" should be physical or logos.`);
    for (const contributor of edition.contributors) {
      if (!ROLES.includes(contributor.role)) problems.push(`Contributor role "${contributor.role}" is not one of: ${ROLES.join(', ')}.`);
    }
    for (const [field, allowed] of Object.entries(SOURCES)) {
      if (edition[field] !== null && !allowed.includes(edition[field])) problems.push(`${field} "${edition[field]}" is not one of: ${allowed.join(', ')}.`);
    }
    if (edition.isbn !== null && !/^\d{13}$/.test(edition.isbn)) problems.push(`ISBN "${edition.isbn}" should be 13 digits.`);
    const identifiers = edition.identifiers || {};
    if (IDENTIFIER_KEYS.some(key => !(key in identifiers) || (identifiers[key] !== null && typeof identifiers[key] !== 'string'))) {
      problems.push(`"identifiers" should hold ${IDENTIFIER_KEYS.join(', ')}, each text or null.`);
    }
    if (edition.setRecord !== null && !isId(edition.setRecord)) problems.push(`"setRecord" should be the ID of a set, or null; it is "${edition.setRecord}".`);
    return problems;
  },
  copy(copy) {
    const problems = [];
    if (!isId(copy.edition)) problems.push('A copy needs the ID of its edition.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(copy.added)) problems.push('"added" should be a date, YYYY-MM-DD.');
    if (!STATUSES.includes(copy.status)) problems.push(`Status "${copy.status}" is not one of: ${STATUSES.join(', ')}.`);
    if (copy.location.length > 4) problems.push('A location has at most four parts: place, room, case, shelf.');
    if (copy.extras.some(extra => typeof extra !== 'string' || !extra)) problems.push('Every entry of "extras" should be a name, such as "Dust jacket".');
    return problems;
  },
  set(set) {
    const problems = [];
    if (!set.title) problems.push('A set needs a title.');
    if (set.volumes !== null && !(Number.isInteger(set.volumes) && set.volumes > 0)) problems.push(`"volumes" should be how many volumes the set has, or null; it is "${set.volumes}".`);
    for (const field of ['price', 'value']) {
      if (set[field] !== null && typeof set[field] !== 'number') problems.push(`"${field}" should be a number, or null.`);
    }
    return problems;
  },
  author(author) {
    return author.name ? [] : ['An author needs a name.'];
  },
  wishlist(item) {
    return item.title ? [] : ['A wishlist item needs a title.'];
  },
};
