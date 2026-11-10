// The trash (PLAN.md, "Status"): deleting moves a record to the trash, and
// restoring brings it back. Nothing is ever erased; Git history keeps every
// version anyway. A record in the trash has the day it was moved there in its
// `trashed` field, and the library leaves it out.

import { withField } from './records.js';

/**
 * Move a book to the trash: its edition, its copies, and any of its works
 * that no other edition (in or out of the trash) uses.
 * @param {Map<string, object>} records every record, by ID
 * @returns {object[]} the changed records, to save
 */
export function trashBook(records, editionId, today, now) {
  const edition = records.get(editionId);
  const all = [...records.values()];
  const copies = all.filter(record => record.type === 'copy' && record.edition === editionId);
  const usedElsewhere = new Set(all.filter(record => record.type === 'edition' && record.id !== editionId)
    .flatMap(other => other.contents.map(entry => entry.work)));
  const works = edition.contents.map(entry => records.get(entry.work))
    .filter(work => work && !usedElsewhere.has(work.id));
  return [edition, ...copies, ...works].filter(record => !record.trashed).map(record => withField(record, 'trashed', today, now));
}

/**
 * Bring a book back: its edition, its copies, and its works.
 * @returns {object[]} the changed records, to save
 */
export function restoreBook(records, editionId, now) {
  const edition = records.get(editionId);
  const copies = [...records.values()].filter(record => record.type === 'copy' && record.edition === editionId);
  const works = edition.contents.map(entry => records.get(entry.work)).filter(Boolean);
  return [edition, ...copies, ...works].filter(record => record.trashed).map(record => withField(record, 'trashed', null, now));
}

/** Move one record (a wishlist item, say) to the trash, or back with `today` null. */
export const trashRecord = (record, today, now) => withField(record, 'trashed', today, now);

/** What is in the trash, as the trash list shows it: editions and wishlist items, newest first. */
export function trashedItems(records) {
  return [...records.values()]
    .filter(record => record.trashed && (record.type === 'edition' || record.type === 'wishlist'))
    .sort((a, b) => b.trashed.localeCompare(a.trashed) || a.title.localeCompare(b.title));
}
