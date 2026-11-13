// Importing a Logos Library export (PLAN.md, "logos-to-my-loci-library"):
// rows are matched to editions by Logos resource ID. A new resource becomes a
// work, an edition (medium "logos") and a copy. On later runs a field is
// updated only if it still holds what the importer last wrote there, so a
// field edited in Loci is never overwritten. What the importer last wrote is
// kept in the data repository, in integrations/logos-import.json.
//
// A full (unfiltered) export marks resources missing from it "gone from
// Logos"; a filtered export never removes anything. Original dates are never
// filled in from Logos: only a person sets them, or a known set's list that a
// person has checked.
//
// A new resource that is a volume of a known set ("Luther's Works, Vol. 31",
// in the series "Luther's Works") takes that volume's works from the list
// (sets/, core/known-sets.js), as a scanned copy does on the phone.

import { newRecord, withField } from '../core/records.js';
import { normalizeForSearch } from '../core/search.js';
import { suggestWorks } from '../core/matching.js';
import { buildLibrary } from '../core/library.js';
import { findKnownVolume, recordsForKnownVolume } from '../core/known-sets.js';
import { readRow } from './columns.mjs';

// "Luther's Works, Vol. 31: Career of the Reformer I" names volume 31; "Volume II/1" names II/1.
const VOLUME_IN_TITLE = /\bvol(?:ume)?\.?\s*([0-9]+[a-z]?|[ivxlc]+(?:\/\d+)?)\b/i;

/** The known set and volume a Logos resource is, by its ISBN or by its series (or title) and the volume in its title. */
export function knownVolumeOf(read, sets) {
  const label = (read.title.match(VOLUME_IN_TITLE) || [])[1] || '';
  for (const setName of [read.series, read.title.split(/[,:]/)[0]].filter(Boolean)) {
    const known = findKnownVolume(sets, { isbn: read.isbn || '', set: setName, volume: label });
    if (known && known.volume) return known;
  }
  return null;
}

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
 * @param {{ now: string, today: string, newId: () => string, full?: boolean, sets?: object[] }} options full: the export lists every resource;
 *   sets: the known sets' lists (shared/known-sets.mjs)
 * @returns {{ changed: object[], added: string[], updated: string[], kept: number, gone: string[], back: string[], fromSets: string[], suggestions: { editionId: string, workId: string, text: string }[], problems: string[] }}
 *   fromSets: the new books whose works came from a known set's list
 */
const MANY_GONE = 10; // more books than this going at once is questioned
const MANY_GONE_SHARE = 0.1; // or more than a tenth of the Logos library, whichever is larger

export function importRows(rows, records, memory, { now, today, newId, full = false, sets = [], allowManyGone = false }) {
  const result = { changed: [], added: [], updated: [], kept: 0, gone: [], back: [], fromSets: [], suggestions: [], problems: [] };
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
      const authorId = person => {
        let author = authors.get(normalizeForSearch(person.name)) || (person.sortName && authors.get(normalizeForSearch(person.sortName)));
        if (!author) {
          author = newRecord('author', newId(), now, { name: person.name, ...(person.sortName !== undefined ? { sortName: person.sortName } : {}) });
          knowAuthor(author);
          result.changed.push(author);
        }
        return author.id;
      };
      // A volume of a known set: its works come from the list, with the set and volume, and no links are suggested.
      const known = knownVolumeOf(read, sets);
      if (known) {
        // The works of our other volumes of this set, including those made earlier in this run, so a work across volumes stays one.
        const all = [...records, ...result.changed];
        const editions = all.filter(record => record.type === 'edition' && !record.trashed && record.set && normalizeForSearch(record.set) === normalizeForSearch(known.set.set));
        const workIds = new Set(editions.flatMap(edition => edition.contents.map(piece => piece.work)).filter(Boolean));
        const setWorks = all.filter(record => record.type === 'work' && workIds.has(record.id));
        const made = recordsForKnownVolume(known.set, known.volume, { newId, now, setWorks, authorIds: names => names.map(name => authorId({ name })) });
        const edition = newRecord('edition', newId(), now, {
          ...values, contents: made.contents, set: known.set.set, volume: known.volume.label, medium: 'logos', logosId: read.logosId,
        });
        const copy = newRecord('copy', newId(), now, { edition: edition.id, added: today, status: 'owned' });
        result.changed.push(...made.works, edition, copy);
        result.added.push(read.title);
        result.fromSets.push(read.title);
        memory.imported[read.logosId] = values;
        continue;
      }
      const authorIds = read.authors.map(authorId);
      const work = newRecord('work', newId(), now, { title: read.title, subtitle: read.subtitle, authors: authorIds });
      const edition = newRecord('edition', newId(), now, {
        ...values, contents: [{ work: work.id, extent: 'complete', translator: null, pages: null }], medium: 'logos', logosId: read.logosId,
      });
      const copy = newRecord('copy', newId(), now, { edition: edition.id, added: today, status: 'owned' });
      result.changed.push(work, edition, copy);
      result.added.push(read.title);
      memory.imported[read.logosId] = values;
      // A work we already have (from a physical book) may be this one: suggested, never linked here.
      // A work with no author (a book of the Bible) is never suggested for a book that has one
      // (a commentary titled "Romans" is not the Epistle).
      const matches = suggestWorks(read.title, read.authors.map(person => person.name), library).filter(match => match.authors.length || !read.authors.length);
      for (const match of matches) {
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
    let owned = 0;
    for (const [logosId, edition] of byLogosId) {
      if (edition.trashed) continue;
      for (const copy of copiesOf(edition.id)) {
        if (copy.status !== 'owned') continue;
        owned++;
        if (!seen.has(logosId)) { result.changed.push(withField(copy, 'status', 'gone from Logos', now)); result.gone.push(edition.title); }
      }
    }
    // A whole library seldom loses many books at once. A file that would mark
    // a large share gone is far more likely a partial export or the wrong file.
    if (!allowManyGone && result.gone.length > Math.max(MANY_GONE, owned * MANY_GONE_SHARE)) {
      throw new Error(`This export would mark ${result.gone.length} of your ${owned} Logos books as gone from Logos. `
        + 'That usually means the file is not the whole library (a collection, a filtered list, or the wrong file). Nothing was changed. '
        + 'If the file is right, import it without "it lists the whole Logos library", or run logos-import with --full --many-gone.');
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
