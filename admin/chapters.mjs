// The chapters of the admin page's handbook. Each shows a part of one of the
// project's own documents, read when the page opens, so every fact is written
// in one place only: change the document, and the page follows. A chapter
// names its document and section; the tests check that each still exists.
// Only the short opening line of each chapter is written here.

/**
 * @typedef {{ repo: 'app'|'tools', file: string, section?: string, leaveOut?: string[] }} Source
 *   section: one section's heading (the whole document when not given);
 *   leaveOut: headings of sections not shown (with what is under them)
 * @typedef {{ id: string, title: string, opening: string, tools?: boolean, sources: Source[] }} Chapter
 */

/** @type {Chapter[]} */
export const CHAPTERS = [
  {
    id: 'what-it-is',
    title: 'What it is',
    opening: 'My Loci Library is a catalog of our books: the physical ones on the shelves and the Logos library. It is three things that work together: an app in the browser, a private folder of small text files on GitHub that holds the catalog, and the tools on this laptop.',
    sources: [{ repo: 'app', file: 'HOW_IT_WORKS.md', section: 'The parts' }],
  },
  {
    id: 'adding',
    title: 'Adding a book',
    opening: 'Adding asks only what a person knows and lets the catalogs fill the rest.',
    sources: [{ repo: 'app', file: 'HOW_IT_WORKS.md', section: 'What happens when you add a book' }],
  },
  {
    id: 'sync',
    title: 'Sync between devices',
    opening: 'Each phone and this laptop keep a whole copy of the catalog and send each other their changes through GitHub.',
    sources: [{ repo: 'app', file: 'HOW_IT_WORKS.md', section: 'Sync between devices' }],
  },
  {
    id: 'tools',
    title: 'The laptop tools',
    opening: 'The buttons run the same tools as the command line, on this laptop, against the catalog named in config.json. Each says what it did when it finishes.',
    tools: true,
    sources: [{ repo: 'tools', file: 'README.md', leaveOut: ['License', 'Tests'] }],
  },
  {
    id: 'data',
    title: 'The data and its format',
    opening: 'The catalog is plain text: one small JSON file per work, edition, copy and author. This is the full description of every field, and the one place it is written.',
    sources: [{ repo: 'app', file: 'DATA_FORMAT.md' }],
  },
  {
    id: 'looking-after',
    title: 'The yearly check, and fixing things',
    opening: 'Ten minutes once a year keeps everything honest, and most troubles have a short fix.',
    sources: [{ repo: 'app', file: 'HOW_IT_WORKS.md', section: 'Looking after it' }],
  },
  {
    id: 'sources',
    title: 'Where the book data comes from',
    opening: 'The catalogs the app and the tools ask, what each gives, and the terms each sets.',
    sources: [{ repo: 'app', file: 'SOURCES.md' }],
  },
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** A chapter's number as the page writes it: I, II, III… */
export const chapterNumber = index => ROMAN[index] || String(index + 1);
