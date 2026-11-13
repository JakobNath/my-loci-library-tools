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

/** One work as a contents line, for editing contents that already exist. */
export function contentsLine(work, authorNames) {
  const dating = work.datings.find(d => d.working) || work.datings[0];
  return [authorNames.join(' and '), work.title, dating ? dating.text : ''].filter(Boolean).join(' — ');
}
