// Whether a book is a Bible. Scripture is cited by book, chapter and verse,
// never as a section of a book (Chicago Manual of Style; SBL Handbook), so a
// Bible gets no Zotero section per biblical book and no contents suggested
// from a catalog record (HOW_IT_WORKS.md, "No Zotero sections for Bibles").

import { normalizeForSearch } from './search.js';

// The books of the Bible, with the deuterocanonical books and other common
// names, as plain lowercase words ("1 corinthians", "song of songs").
const BIBLE_BOOKS = new Set([
  'genesis', 'exodus', 'leviticus', 'numbers', 'deuteronomy', 'joshua', 'judges', 'ruth', '1 samuel', '2 samuel', '1 kings', '2 kings',
  '1 chronicles', '2 chronicles', 'ezra', 'nehemiah', 'esther', 'job', 'psalms', 'psalm', 'proverbs', 'ecclesiastes', 'qoheleth',
  'song of songs', 'song of solomon', 'canticles', 'isaiah', 'jeremiah', 'lamentations', 'ezekiel', 'daniel', 'hosea', 'joel', 'amos',
  'obadiah', 'jonah', 'micah', 'nahum', 'habakkuk', 'zephaniah', 'haggai', 'zechariah', 'malachi',
  'tobit', 'judith', 'wisdom of solomon', 'wisdom', 'sirach', 'ecclesiasticus', 'baruch', '1 maccabees', '2 maccabees', '3 maccabees', '4 maccabees',
  '1 esdras', '2 esdras', 'prayer of manasseh', 'additions to esther', 'letter of jeremiah',
  'matthew', 'mark', 'luke', 'john', 'acts', 'acts of the apostles', 'romans', '1 corinthians', '2 corinthians', 'galatians', 'ephesians',
  'philippians', 'colossians', '1 thessalonians', '2 thessalonians', '1 timothy', '2 timothy', 'titus', 'philemon', 'hebrews', 'james',
  '1 peter', '2 peter', '1 john', '2 john', '3 john', 'jude', 'revelation', 'apocalypse',
]);

const ORDINALS = { 'first ': '1 ', 'second ': '2 ', 'third ': '3 ' };

/** Whether a title names a book of the Bible: "Romans", "First Corinthians", "1 Corinthians". */
export function isBibleBook(title) {
  const plain = normalizeForSearch(title).replace(/^the /, '').replace(/^(first|second|third) /, word => ORDINALS[word]);
  return BIBLE_BOOKS.has(plain);
}

/**
 * Whether a book is a Bible (or a Testament): marked as one by its category
 * or by Logos, or an anthology at least half of whose works are books of the
 * Bible (NA28, BHS, a study Bible). Categories alone are not enough, since a
 * Greek New Testament's books may be filed under "Biblical studies".
 * @param {{ edition: object, works: { title: string, category?: string|null }[] }} entry
 *   a library entry, or a book being added (its edition so far, and its works or contents)
 * @returns {boolean}
 */
export function isBible({ edition, works }) {
  if (edition && edition.logosExtra && edition.logosExtra['Resource Type'] === 'Bible') return true;
  if (works.some(work => /^bibles?$/i.test(work.category || ''))) return true;
  const biblical = works.filter(work => isBibleBook(work.title)).length;
  return works.length > 1 && biblical * 2 >= works.length;
}
