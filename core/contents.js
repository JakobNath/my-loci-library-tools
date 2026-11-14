// Pasting a table of contents: one work per line, as "Author — Title",
// "Title", or "Author — Title — date" (PLAN.md, "Anthologies"). An em dash,
// a double hyphen or a bar separates the parts; ordinary hyphens and en
// dashes stay part of titles ("Romans 1–8").

import { parseDating } from './dating.js';

const SEPARATOR = /\s+(?:—|--|\|)\s+|\s*—\s*/;

/**
 * Read pasted contents.
 * @param {string} text one work per line
 * @returns {{ author: string|null, title: string, date: string|null }[]}
 */
export function parseContentsLines(text) {
  const pieces = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const parts = line.split(SEPARATOR).map(part => part.trim()).filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1) pieces.push({ author: null, title: parts[0], date: null });
    else if (parts.length === 2 && parseDating(parts[1]).ok) pieces.push({ author: null, title: parts[0], date: parts[1] });
    else if (parts.length === 2) pieces.push({ author: parts[0], title: parts[1], date: null });
    else {
      // Three parts or more: the last is the date only if it reads as one;
      // otherwise it belongs to the title ("Author — Title — Subtitle").
      const last = parts[parts.length - 1];
      const hasDate = parseDating(last).ok;
      pieces.push({ author: parts[0], title: parts.slice(1, hasDate ? -1 : undefined).join(' — '), date: hasDate ? last : null });
    }
  }
  return pieces;
}

// A heading the page prints above its list, in the languages of this library.
const HEADINGS = /^(contents|table of contents|inhalt|inhaltsverzeichnis|index|conspectus|sommaire|indice)$/i;
// A page number as printed: 12, xvii.
const PAGE_NUMBER = /^(\d{1,4}|[ivxlc]{1,8})$/i;
const TRAILING_PAGE = /\s+(\d{1,4}|[ivxlc]{1,8})$/i;

/**
 * Text copied from a printed contents page (a phone's text reading, or a
 * web page), made into one work per line: dotted leaders, a heading such as
 * "Contents", lines that are only a page number, and blank lines go; a page
 * number at the end of a line goes when most lines end in one (a page column),
 * so a title such as "Psalm 23" on its own keeps its number. The result is
 * shown in the box to be corrected, never saved unseen.
 * @param {string} text as pasted
 * @returns {string} the tidied lines, joined by line breaks
 */
export function tidyPastedContents(text) {
  const lines = String(text ?? '').split(/\r?\n/)
    .map(line => line.replace(/(\s*[.·…_]\s*){3,}/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(line => line && !HEADINGS.test(line) && !PAGE_NUMBER.test(line));
  const numbered = lines.filter(line => TRAILING_PAGE.test(line)).length;
  const stripped = lines.map(line => line.replace(TRAILING_PAGE, ''));
  // Taking the numbers off must not make lines alike: "Psalm 23" and "Psalm 51" are titles, not pages.
  const pageColumn = lines.length > 1 && numbered / lines.length >= 0.6 && new Set(stripped).size === stripped.length;
  return (pageColumn ? stripped : lines).join('\n');
}

/** One work as a contents line, for editing contents that already exist. */
export function contentsLine(work, authorNames) {
  const dating = work.datings.find(d => d.working) || work.datings[0];
  return [authorNames.join(' and '), work.title, dating ? dating.text : ''].filter(Boolean).join(' — ');
}
