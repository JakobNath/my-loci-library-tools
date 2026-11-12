// Turning what a person typed in the entry form into records: new authors
// and works where needed, the edition, and its copy. For an existing book,
// only the fields that changed are stamped, so merging stays precise.

import { newRecord, withField } from './records.js';
import { parseDating } from './dating.js';
import { parseContentsLines } from './contents.js';
import { normalizeForSearch } from './search.js';
import { trashRecord } from './trash.js';

/**
 * An ISBN as 13 digits, from what was typed or scanned (ISBN-10 is converted).
 * @returns {string|null} null when there is no valid ISBN in the text
 */
export function isbn13(text) {
  const plain = String(text ?? '').toUpperCase().replace(/[^0-9X]/g, '');
  if (/^\d{13}$/.test(plain)) return plain;
  if (!/^\d{9}[\dX]$/.test(plain)) return null;
  const body = '978' + plain.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return body + ((10 - (sum % 10)) % 10);
}

/**
 * An ISBN found in what was typed or pasted: an ISBN itself, or a link to a
 * printed book on Amazon, whose address carries the ISBN-10 ("/dp/0199540144").
 * Nothing is fetched: the link is only read. Kindle links ("/dp/B0...") and
 * short links (a.co/...) carry no ISBN.
 * @returns {string|null} 13 digits, or null
 */
export function isbnInText(text) {
  const link = String(text ?? '').match(/\/(?:dp|gp\/product|product)\/([0-9]{9}[0-9X])(?=[/?#]|$)/i);
  if (link) return isbn13(link[1]);
  return /^[\d\sX-]+$/i.test(String(text ?? '').trim()) ? isbn13(text) : null;
}

const key = text => normalizeForSearch(text);

/**
 * Datings from the form's rows, read with the date parser.
 * @returns {{ datings: object[], problems: string[] }}
 */
export function datingsFromRows(rows) {
  const datings = [];
  const problems = [];
  for (const row of rows) {
    if (!row.text.trim()) continue;
    const read = parseDating(row.text);
    if (!read.ok) { problems.push(read.problem); continue; }
    datings.push({ ...read.dating, kind: row.kind || null, note: row.note || '', working: !!row.working });
  }
  if (datings.length && datings.filter(dating => dating.working).length !== 1) {
    datings.forEach((dating, i) => { dating.working = i === 0; });
  }
  return { datings, problems };
}

// Change a record field by field, stamping only what differs.
function update(record, values, now) {
  let result = record;
  for (const [name, value] of Object.entries(values)) {
    if (JSON.stringify(result[name]) !== JSON.stringify(value)) result = withField(result, name, value, now);
  }
  return result;
}

/** A copy's value history without the entries of the given dates. */
export function valueHistoryWithout(history, dates) {
  return history.filter(point => !dates.includes(point.date));
}

/**
 * A wishlist item from its small form (PLAN.md, "Wishlist"): new, or the
 * existing item with only what changed stamped.
 * @param {{ title: string, subtitle?: string, authors?: string, translator?: string, publisher?: string, isbn?: string, notes?: string }} form
 *   authors: names separated by ";"
 * @param {object|null} existing
 * @returns {{ record: object|null, problems: string[] }}
 */
export function wishFromForm(form, existing, { newId, now }) {
  const text = value => String(value ?? '').trim();
  if (!text(form.title)) return { record: null, problems: ['A wishlist item needs a title.'] };
  const values = {
    title: text(form.title),
    subtitle: text(form.subtitle) || null,
    authors: text(form.authors).split(';').map(name => name.trim()).filter(Boolean),
    contributors: text(form.translator) ? [{ name: text(form.translator), role: 'translator' }] : [],
    publisher: text(form.publisher) || null,
    isbn: isbn13(form.isbn) || text(form.isbn) || null,
    notes: text(form.notes),
  };
  if (existing) {
    // Other contributors (an editor, say) are kept; only the translator comes from the form.
    values.contributors = [...existing.contributors.filter(person => person.role !== 'translator'), ...values.contributors];
    return { record: update(existing, values, now), problems: [] };
  }
  return { record: newRecord('wishlist', newId(), now, values), problems: [] };
}

/**
 * The entry form's starting values for a wishlist item just bought: its
 * details, and its note on the new copy (PLAN.md, "Wishlist").
 */
export function formFromWish(wish) {
  return {
    edition: { title: wish.title, subtitle: wish.subtitle, contributors: wish.contributors, publisher: wish.publisher, isbn: wish.isbn, languages: [], medium: 'physical', images: wish.images },
    authorsText: wish.authors.join('; '),
    notes: wish.notes,
  };
}

/**
 * Build the records for one book from the form.
 * @param {object} form the values typed (see ui/edit.js for its shape)
 * @param {{ edition: object, copy: object|null, works: object[] }|null} existing the book being edited, or null for a new one
 * @param {{ newId: () => string, now: string, today: string, authors: object[], works?: Map<string, object>, usedElsewhere?: (workId: string) => boolean }} context
 *   works: every work by ID, needed when form.workId links the book to an existing work;
 *   usedElsewhere: whether another book holds a work, so a work this book no longer lists is
 *   trashed only when nothing else holds it (without it, nothing is trashed)
 * @returns {{ records: object[], editionId: string|null, problems: string[] }}
 */
export function recordsFromForm(form, existing, context) {
  const { newId, now, today, authors } = context;
  const problems = [];
  const records = [];
  if (!form.title.trim()) problems.push('A title is needed.');
  const isbn = form.isbn.trim() ? isbn13(form.isbn) : null;
  if (form.isbn.trim() && !isbn) problems.push(`"${form.isbn}" is not an ISBN (10 or 13 digits).`);

  // Authors: an existing record with the same name or name form, or a new one.
  const known = new Map();
  for (const author of authors) for (const name of [author.name, ...author.otherNames]) known.set(key(name), author.id);
  const authorIds = names => names.map(name => name.trim()).filter(Boolean).map(name => {
    if (!known.has(key(name))) {
      const author = newRecord('author', newId(), now, { name });
      records.push(author);
      known.set(key(name), author.id);
    }
    return known.get(key(name));
  });

  // Works: one for a single book, or one per contents line for an anthology.
  const oldWorks = existing ? existing.works : [];
  let contents;
  if (form.contents !== null) {
    contents = [];
    // The works of a known set's volume (core/known-sets.js), when the contents came from its list.
    const knownSet = form.knownWorks || { set: '', works: [] };
    for (const line of parseContentsLines(form.contents)) {
      // A line still as the list gives it takes the list's details; a line a person changed is saved as typed.
      const listed = knownSet.works.find(item => key(item.title) === key(line.title) && key(item.author) === key(line.author || ''));
      if (listed && listed.piece) {
        const piece = { title: line.title, author: line.author || null, originalTitle: listed.originalTitle || null, date: line.date || null };
        contents.push({ work: null, piece, extent: 'complete', translator: listed.translator || null, pages: listed.pages || null, cite: false });
        continue;
      }
      const ids = authorIds(line.author ? line.author.split(/\s+and\s+/) : []);
      const note = listed && line.date === listed.date ? `from the ${knownSet.set} list` : '';
      const reading = line.date ? datingsFromRows([{ text: line.date, working: true, note }]) : { datings: [], problems: [] };
      problems.push(...reading.problems);
      const match = oldWorks.find(work => key(work.title) === key(line.title));
      const values = { title: line.title, authors: ids, ...(line.date ? { datings: reading.datings } : {}) };
      // A new work in a collection takes the language, category and tags asked once for the whole book,
      // and from a known set's list its own original title and language.
      const shared = {
        originalLanguage: (listed && listed.originalLanguage) || form.work.originalLanguage || null, category: form.work.category || null, tags: form.work.tags,
        ...(listed && listed.originalTitle ? { originalTitle: listed.originalTitle } : {}),
      };
      const work = match ? update(match, values, now) : newRecord('work', newId(), now, { ...values, ...shared });
      if (work !== match) records.push(work);
      contents.push({ work: work.id, piece: null, extent: 'complete', translator: (listed && listed.translator) || null, pages: (listed && listed.pages) || null, cite: false });
    }
    if (!contents.length) problems.push('List at least one work in the contents, one per line.');
  } else if (form.workId && context.works) {
    // A person confirmed "same work as ...": link to it, and give it a
    // dating only if it has none yet (an existing dating is never replaced here).
    const work = context.works.get(form.workId);
    if (!work) problems.push('The work chosen to link to is no longer in the catalog.');
    else {
      const reading = datingsFromRows(form.work.datings);
      problems.push(...reading.problems);
      if (!work.datings.length && reading.datings.length) records.push(withField(work, 'datings', reading.datings, now));
      contents = [{ work: work.id, piece: null, extent: 'complete', translator: null, pages: null, cite: false }];
    }
  } else {
    const reading = datingsFromRows(form.work.datings);
    problems.push(...reading.problems);
    const values = {
      title: form.work.title || form.title.trim(), authors: authorIds(form.authors),
      originalTitle: form.work.originalTitle || null, originalLanguage: form.work.originalLanguage || null,
      datings: reading.datings, category: form.work.category || null, tags: form.work.tags,
    };
    const old = oldWorks.length === 1 ? oldWorks[0] : null;
    const work = old ? update(old, values, now) : newRecord('work', newId(), now, values);
    if (work !== old) records.push(work);
    contents = [{ work: work.id, piece: null, extent: 'complete', translator: null, pages: null, cite: false }];
  }
  if (problems.length) return { records: [], editionId: null, problems };
  // A work this book no longer lists goes to the trash, unless another book holds it too
  // (turning a book into a collection used to leave its first work behind, unused).
  const usedElsewhere = context.usedElsewhere || (() => true);
  const listed = new Set(contents.map(entry => entry.work));
  for (const work of oldWorks) {
    if (!listed.has(work.id) && !work.trashed && !usedElsewhere(work.id)) records.push(trashRecord(work, today, now));
  }

  const editionValues = {
    title: form.title.trim(), subtitle: form.subtitle || null, contents, contributors: form.contributors.filter(person => person.name.trim()),
    publisher: form.publisher || null, place: form.place || null, year: form.year ? Number(form.year) : null,
    editionStatement: form.editionStatement || null, translationFirstPublished: form.translationFirstPublished ? Number(form.translationFirstPublished) : null,
    series: form.series || null, seriesNumber: form.seriesNumber || null, set: form.set || null, volume: form.volume || null,
    isbn, languages: form.languages, pages: form.pages || null, medium: form.medium, logosId: form.logosId || null,
  };
  const edition = existing ? update(existing.edition, editionValues, now) : newRecord('edition', newId(), now, editionValues);
  if (!existing || edition !== existing.edition) records.push(edition);

  const copyForm = form.copy;
  const value = copyForm.value === '' ? null : Number(copyForm.value);
  const oldCopy = existing && existing.copy;
  // Entries ticked for deletion in the form go first (PLAN.md: "history can be deleted").
  let history = valueHistoryWithout(oldCopy ? oldCopy.valueHistory : [], copyForm.dropHistory || []);
  if (value !== null && (!oldCopy || oldCopy.value !== value)) {
    // One value per day: a second change today replaces today's entry.
    history = [...history.filter(point => point.date !== today), { date: today, value }];
  }
  const copyValues = {
    binding: copyForm.binding || null, location: copyForm.location.filter(Boolean), acquired: copyForm.acquired || null,
    price: copyForm.price === '' ? null : Number(copyForm.price), value, valueHistory: history,
    markings: copyForm.markings, notes: copyForm.notes, status: copyForm.status,
    ...(copyForm.shelfOrder !== undefined ? { shelfOrder: copyForm.shelfOrder || null } : {}),
  };
  const copy = oldCopy ? update(oldCopy, copyValues, now) : newRecord('copy', newId(), now, { ...copyValues, edition: edition.id, added: today });
  if (copy !== oldCopy) records.push(copy);
  return { records, editionId: edition.id, problems };
}

/**
 * Another copy of an edition already in the catalog ("You already have this
 * edition. Add another copy?").
 * @returns {object} the new copy record
 */
export function anotherCopy(editionId, copyForm, { newId, now, today }) {
  return newRecord('copy', newId(), now, {
    edition: editionId, added: today, binding: copyForm.binding || null, location: copyForm.location.filter(Boolean),
    shelfOrder: copyForm.shelfOrder || null, acquired: copyForm.acquired || null, notes: copyForm.notes || '', status: 'owned',
  });
}

// A volume label written in Roman numerals ("IV"), as on many older sets.
const ROMAN_LABEL = /^[IVXLC]+$/;

/**
 * The volumes of a set, pasted one per line ("Adding a set"): "7 Plato",
 * "8 Aristotle I", "I/1 The Doctrine of the Word of God". The first word is
 * the volume label when it holds a digit or is a Roman numeral; a line with
 * no such word is a title without a label.
 * @param {string} text
 * @param {string} setTitle the title for a line that is only a label ("31": "Luther's Works, vol. 31")
 * @returns {{ volume: string, title: string }[]}
 */
export function volumesFromLines(text, setTitle) {
  return String(text ?? '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [first, ...rest] = line.split(/\s+/);
    if (!/\d/.test(first) && !ROMAN_LABEL.test(first)) return { volume: '', title: line };
    const volume = first.replace(/[.:,]$/, '');
    const title = rest.join(' ').replace(/^[-–—:]\s*/, '');
    return { volume, title: title || `${setTitle}, vol. ${volume}` };
  });
}

/**
 * The volume label likely to come next: "31" gives "32", "I/1" gives "I/2".
 * @returns {string} empty when there is no number at the end to count on from
 */
export function nextVolumeLabel(label) {
  const match = String(label ?? '').match(/^(.*?)(\d+)$/);
  return match ? match[1] + (Number(match[2]) + 1) : '';
}

/**
 * A volume's looked-up details with its set's shared facts, given once when
 * "Adding a set". The set's title, publisher, edition and binding apply to
 * every volume, and its general editors are added once each. The year found
 * for the volume is kept, since a set's volumes often appear over decades;
 * the set's year fills in only when none was found.
 * @param {object} found what the lookups found (core/lookup.js, emptyFound)
 * @param {{ title: string, publisher: string, year: string, editionStatement: string, editors: string[], binding: string }} set
 * @param {string} volume the volume label
 * @returns {object} a new found object; the input is not changed
 */
export function withSetFacts(found, set, volume) {
  const named = new Set(found.contributors.map(person => key(person.name)));
  const editors = set.editors.filter(name => !named.has(key(name))).map(name => ({ name, role: 'editor' }));
  return {
    ...found,
    set: set.title,
    volume,
    publisher: set.publisher || found.publisher,
    editionStatement: set.editionStatement || found.editionStatement,
    year: found.year || set.year,
    binding: set.binding || found.binding,
    contributors: [...found.contributors, ...editors],
  };
}

/** Whether a scanned code is a book's ISBN: 13 digits, starting 978 or 979, with a correct check digit. */
export function isBookBarcode(code) {
  if (!/^97[89]\d{10}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

/**
 * The works of a collection, from the rows of "Works in this book" (PLAN.md,
 * "Book detail page"): each work's title, original title and language, date,
 * category and tags. A box in "same for all" fills that field for every work
 * whose own box was left empty. Only fields that changed are stamped. A work
 * with several datings (a disputed work) keeps them: its date is changed on its
 * own, in the entry form of a book holding only it.
 * @param {{ id: string, title: string, originalTitle: string, originalLanguage: string, dating: string, category: string, tags: string[] }[]} rows
 * @param {{ originalLanguage: string, category: string, tags: string[] }} same the "same for all" boxes
 * @param {Map<string, object>} works the works, by ID
 * @param {string} now timestamp for the changed fields
 * @returns {{ records: object[], problems: string[] }} the changed works, or what to correct
 */
export function worksFromRows(rows, same, works, now) {
  const records = [];
  const problems = [];
  for (const row of rows) {
    const work = works.get(row.id);
    if (!work) continue;
    const title = row.title.trim();
    if (!title) { problems.push(`A work needs a title (it was "${work.title}").`); continue; }
    const values = {
      title,
      originalTitle: row.originalTitle.trim() || null,
      originalLanguage: row.originalLanguage.trim() || same.originalLanguage.trim() || null,
      category: row.category.trim() || same.category.trim() || null,
      tags: row.tags.length ? row.tags : same.tags,
    };
    if (work.datings.length <= 1) {
      const current = work.datings[0];
      const text = row.dating.trim();
      if (!text) values.datings = [];
      else if (!current || current.text !== text) {
        const reading = datingsFromRows([{ text, note: current ? current.note : '', working: true }]);
        if (reading.problems.length) { problems.push(`${title}: ${reading.problems[0]}`); continue; }
        values.datings = reading.datings;
      }
    }
    const changed = update(work, values, now);
    if (changed !== work) records.push(changed);
  }
  return { records: problems.length ? [] : records, problems };
}
