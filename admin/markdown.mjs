// A small reader of the Markdown the project's documents are written in,
// so the admin page can show them as they stand, with no copy to keep in
// step. It knows what those documents use: headings, paragraphs, lists,
// tables, code blocks, and inline code, bold, italics and links. Everything
// is escaped first, so no text in a document can become part of the page.

const escapeHtml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Inline marks in one escaped line: `code`, **bold**, *italics*, [links](address). */
function inline(text) {
  const codes = [];
  let html = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, address) => (/^(https?:|#|mailto:)/.test(address)
      ? `<a href="${address}"${address.startsWith('#') ? '' : ' target="_blank" rel="noopener"'}>${label}</a>` : `${label} (<code>${address}</code>)`));
  return html.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

/**
 * Turn Markdown into HTML.
 * @param {string} markdown
 * @param {{ headingShift?: number }} [options] headingShift: added to each heading's level (## becomes h3 with 1)
 * @returns {string}
 */
export function markdownToHtml(markdown, { headingShift = 0 } = {}) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const code = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingShift);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const item = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const items = [];
      while (i < lines.length) {
        const next = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (next && next[1].length <= item[1].length) { items.push(next[3]); i++; continue; }
        // A line indented under an item belongs to it (a nested list or a wrapped line).
        if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) { items[items.length - 1] += ` ${lines[i].trim()}`; i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map(text => `<li>${inline(text)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*]|\d+\.)\s|\s*\|)/.test(lines[i])) paragraph.push(lines[i++].trim());
    if (!paragraph.length) paragraph.push(lines[i++].trim());
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return out.join('\n');
}

/**
 * One section of a document: from its heading to the next heading of the same
 * or a higher level, without the heading itself.
 * @param {string} markdown
 * @param {string} title the heading's text ("The parts")
 * @returns {string|null} null when the document has no such heading
 */
export function sectionOf(markdown, title) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.replace(/^#+\s+/, '') === title && /^#+\s/.test(line));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#+\s/.test(lines[end]) && lines[end].match(/^#+/)[0].length <= level)) end++;
  return lines.slice(start + 1, end).join('\n');
}

export { escapeHtml };
