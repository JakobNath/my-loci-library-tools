// Importing a Logos Library export (PLAN.md, "logos-to-my-loci-library"):
// rows are matched to editions by Logos resource ID. A new resource becomes a
// work, an edition (medium "logos") and a copy. On later runs a field is
// updated only if it still holds what the importer last wrote there, so a
// field edited in Loci is never overwritten. What the importer last wrote is
// kept in the data repository, in integrations/logos-import.json.
//
// A full (unfiltered) export marks resources missing from it "gone from
// Logos"; a filtered export never removes anything. Original dates are never
// filled in: only a person sets them.

import { newRecord, withField } from '../core/records.js';
import { normalizeForSearch } from '../core/search.js';
import { suggestWorks } from '../core/matching.js';
import { buildLibrary } from '../core/library.js';
import { readRow } from './columns.mjs';

// The edition fields the export supplies, as the importer writes them.
const editionValues = read => ({
  title: read.title,
  subtitle: read.subtitle,
  publisher: read.publisher,
  year: read.year,
  series: read.series,
  languages: read.languages,
  isbn: read.isbn,
  logosExtra: read.extra,
});

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {Record<string, string>[]} rows from parseCsv
 * @param {object[]} records every record in the data repository
 * @param {{ imported: Record<string, object> }} memory integrations/logos-import.json: per resource, the values last written
 * @param {{ now: string, today: string, newId: () => string, full?: boolean }} options full: the export lists every resource
 * @returns {{ changed: object[], added: string[], updated: string[], kept: number, gone: string[], back: string[], suggestions: { editionId: string, workId: string, text: string }[], problems: string[] }}
 */
export function importRows(rows, records, memory, { now, today, newId, full = false }) {
  const result = { changed: [], added: [], updated: [], kept: 0, gone: [], back: [], suggestions: [], problems: [] };
  const byLogosId = new Map(records.filter(record => record.type === 'edition' && record.logosId).map(edition => [edition.logosId, edition]));
  const copiesOf = editionId => records.filter(record => record.type === 'copy' && record.edition === editionId);
  // Authors by every form of their name, so "C. S. Lewis" and "Lewis, C. S." are one person.
  const authors = new Map();
  const knowAuthor = author => [author.name, author.sortName, ...author.otherNames].filter(Boolean).forEach(form => authors.set(normalizeForSearch(form), author));
  records.filter(record => record.type === 'author').forEach(knowAuthor);
  const library = buildLibrary(records.filter(record => record.type !== 'edition' || record.medium === 'physical'));
  const seen = new Set();

  for (const [i, row] of rows.entries()) {
    const read = readRow(row);
    if (!read.logosId) { result.problems.push(`Row ${i + 2} has no resource ID, so it was skipped.`); continue; }
    if (!read.title) { result.problems.push(`Row ${i + 2} (${read.logosId}) has no title, so it was skipped.`); continue; }
    if (seen.has(read.logosId)) continue;
    seen.add(read.logosId);
    const values = editionValues(read);
    const existing = byLogosId.get(read.logosId);

    if (!existing) {
      const authorIds = read.authors.map(person => {
        let author = authors.get(normalizeForSearch(person.name)) || (person.sortName && authors.get(normalizeForSearch(person.sortName)));
        if (!author) {
          author = newRecord('author', newId(), now, { name: person.name, sortName: person.sortName });
          knowAuthor(author);
          result.changed.push(author);
        }
        return author.id;
      });
      const work = newRecord('work', newId(), now, { title: read.title, subtitle: read.subtitle, authors: authorIds });
      const edition = newRecord('edition', newId(), now, {
        ...values, contents: [{ work: work.id, extent: 'complete', translator: null, pages: null }], medium: 'logos', logosId: read.logosId,
      });
      const copy = newRecord('copy', newId(), now, { edition: edition.id, added: today, status: 'owned' });
      result.changed.push(work, edition, copy);
      result.added.push(read.title);
      memory.imported[read.logosId] = values;
      // A work we already have (from a physical book) may be this one: suggested, never linked here.
      for (const match of suggestWorks(read.title, read.authors.map(person => person.name), library)) {
        result.suggestions.push({ editionId: edition.id, workId: match.id, text: `${read.title} (Logos) is the same work as ${match.title}` });
      }
      continue;
    }

    // Known resource: update only the fields still as the importer left them.
    const before = memory.imported[read.logosId] || {};
    let edition = existing;
    for (const [field, value] of Object.entries(values)) {
      if (same(edition[field], value)) continue;
      const untouched = field in before ? same(edition[field], before[field]) : edition[field] === null || same(edition[field], []) || same(edition[field], {});
      if (untouched) edition = withField(edition, field, value, now);
    }
    memory.imported[read.logosId] = values;
    if (edition !== existing) { result.changed.push(edition); result.updated.push(read.title); } else result.kept++;
    // Back in the library after being marked gone.
    for (const copy of copiesOf(existing.id)) {
      if (copy.status === 'gone from Logos') { result.changed.push(withField(copy, 'status', 'owned', now)); result.back.push(read.title); }
    }
  }

  if (full) {
    for (const [logosId, edition] of byLogosId) {
      if (seen.has(logosId) || edition.trashed) continue;
      for (const copy of copiesOf(edition.id)) {
        if (copy.status === 'owned') { result.changed.push(withField(copy, 'status', 'gone from Logos', now)); result.gone.push(edition.title); }
      }
    }
  }
  return result;
}

/**
 * Link confirmed suggestions: the Logos edition joins the existing work, and
 * the work the importer made for it goes to the trash (it was used by nothing else).
 * @param {{ editionId: string, workId: string }[]} links confirmed by a person
 * @returns {object[]} the changed records
 */
export function linkEditions(links, records, { now, today }) {
  const byId = new Map(records.map(record => [record.id, record]));
  const changed = [];
  for (const { editionId, workId } of links) {
    const edition = byId.get(editionId);
    if (!edition || !byId.get(workId) || edition.contents.some(entry => entry.work === workId)) continue;
    const old = edition.contents.map(entry => entry.work);
    changed.push(withField(edition, 'contents', [{ work: workId, extent: 'complete', translator: null, pages: null }], now));
    const usedElsewhere = new Set(records.filter(record => record.type === 'edition' && record.id !== editionId).flatMap(other => other.contents.map(entry => entry.work)));
    for (const id of old) if (byId.get(id) && !usedElsewhere.has(id)) changed.push(withField(byId.get(id), 'trashed', today, now));
  }
  return changed;
}
