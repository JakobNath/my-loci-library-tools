// The HTML catalog (PLAN.md, "Backups"): one file that opens in any browser
// with no internet, listing every book with its thumbnail embedded, and a
// search box. It is a backup a person can read without the app, so it uses
// only plain HTML, the browser's own colors, and a few lines of script.

import { escapeHtml } from '../core/html.js';
import { originalDateText } from '../core/exports.js';

const STYLE = `
  :root { color-scheme: light dark; font-family: Georgia, "Times New Roman", serif; }
  body { margin: 0 auto; max-width: 60rem; padding: 1rem; background: Canvas; color: CanvasText; }
  h1 { margin: 0 0 .25rem; } input { font: inherit; width: 100%; padding: .5rem; margin: 1rem 0; box-sizing: border-box; }
  ol { list-style: none; padding: 0; margin: 0; }
  li { display: flex; gap: 1rem; padding: .75rem 0; border-top: 1px solid GrayText; }
  img, .blank { width: 60px; height: 90px; flex: none; object-fit: cover; background: GrayText; }
  .meta { font-size: .9rem; } .gone { opacity: .55; } p { margin: .15rem 0; }`;

const SEARCH = `
  const box = document.querySelector('input');
  const plain = text => text.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
  const rows = [...document.querySelectorAll('li')].map(row => [row, plain(row.textContent)]);
  box.oninput = () => { const words = plain(box.value).split(/\\s+/).filter(Boolean);
    for (const [row, text] of rows) row.hidden = !words.every(word => text.includes(word)); };`;

/**
 * @param {object} library from buildLibrary (core/library.js)
 * @param {(imageId: string) => Buffer|null} thumbnail a cover thumbnail's bytes, if the repository has it
 * @param {{ built: string, dateStyle?: string }} options
 * @returns {string} the whole HTML file
 */
export function catalogHtml(library, thumbnail, { built, dateStyle = 'AD' }) {
  const entries = [...library.entries].sort((a, b) => a.edition.title.localeCompare(b.edition.title));
  const rowsHtml = entries.map(entry => {
    const { edition } = entry;
    const cover = edition.images.find(image => image.kind === 'cover' && !image.waiting);
    const bytes = cover && thumbnail(cover.id);
    const pictureHtml = bytes ? `<img alt="" src="data:image/jpeg;base64,${bytes.toString('base64')}">` : '<span class="blank"></span>';
    const owned = entry.copies.find(copy => copy.status === 'owned');
    const lines = [
      [entry.authorLine, originalDateText(entry, dateStyle)].filter(Boolean).join(' · '),
      [edition.publisher, edition.place, edition.year, edition.editionStatement].filter(Boolean).join(', '),
      [entry.isDigital ? 'Logos' : owned && owned.binding, owned && owned.location.filter(Boolean).join(' › '), !entry.owned && 'No longer in the library'].filter(Boolean).join(' · '),
      entry.copies.map(copy => copy.notes).filter(Boolean).join(' '),
    ].filter(Boolean);
    return `<li${entry.owned ? '' : ' class="gone"'}>${pictureHtml}<div><p><strong>${escapeHtml(edition.title)}</strong>${edition.subtitle ? `: ${escapeHtml(edition.subtitle)}` : ''}</p>`
      + `${lines.map(line => `<p class="meta">${escapeHtml(line)}</p>`).join('')}</div></li>`;
  }).join('\n');
  const physical = library.entries.filter(entry => entry.owned && !entry.isDigital).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Loci Library catalog, ${escapeHtml(built.slice(0, 10))}</title><style>${STYLE}</style></head>
<body><h1>My Loci Library</h1>
<p class="meta">${escapeHtml(`${physical} books on the shelves, ${library.entries.length} editions in all. Made ${built.slice(0, 10)} by loci-backup. Created by Jakob Nath.`)}</p>
<input type="search" placeholder="Search titles, authors, places, notes" aria-label="Search">
<ol>
${rowsHtml}
</ol>
<script>${SEARCH}</script>
</body></html>
`;
}
