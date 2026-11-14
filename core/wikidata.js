// Asking Wikidata when works were written (PLAN.md, "Original dates"): the
// question for one book, as a SPARQL query, and the reading of its answer.
// The question is sent by edges/lookup-wikidata.js. Only standard SPARQL 1.1
// is used, with every prefix written out and no label service, because the
// Wikidata Query Service is moving to a backend without them (SOURCES.md).
// A date found here is only offered: a person accepts it with one tap.

import { normalizeForSearch } from './search.js';


// A title as Wikidata's English label may give it: as it stands, and without a leading article.
function labelsFor(title) {
  const clean = String(title || '').trim();
  const bare = clean.replace(/^(the|a|an)\s+/i, '');
  return [...new Set([clean, bare, bare.charAt(0).toUpperCase() + bare.slice(1)])].filter(Boolean);
}

const literal = text => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;

/**
 * The query for one book: every work title, by its author, at once (Wikidata
 * refuses many quick queries, so a book is never asked work by work). Editions
 * and translations, which have their own items, are left out.
 * @param {string[]} titles the works' English titles
 * @param {string} author the author's name, as the book gives it ("Plato", "Edgar Allan Poe")
 * @param {string} [prefixes] the PREFIX lines naming Wikidata's vocabularies, which the query service needs
 *   written out; they name Wikidata's address, so they are kept in edges/lookup-wikidata.js
 * @returns {string} the query, or '' when there is nothing to ask (no author: a title alone matches too much)
 */
export function worksQuery(titles, author, prefixes = '') {
  const surname = normalizeForSearch(author).split(' ').pop();
  const labels = [...new Set(titles.flatMap(labelsFor))];
  if (!surname || !labels.length) return '';
  return `${prefixes}
SELECT ?title ?work ?time ?precision ?original ?other WHERE {
  VALUES ?title { ${labels.map(literal).join(' ')} }
  ?work rdfs:label ?title ; wdt:P50 ?author .
  ?author rdfs:label ?authorName .
  FILTER(LANG(?authorName) = "en" && CONTAINS(LCASE(?authorName), ${JSON.stringify(surname)}))
  FILTER NOT EXISTS { ?work wdt:P629 ?editionOf }
  OPTIONAL { ?work (p:P571|p:P577)/(psv:P571|psv:P577) ?value . ?value wikibase:timeValue ?time ; wikibase:timePrecision ?precision . }
  OPTIONAL { ?work wdt:P1476 ?original }
  OPTIONAL { ?work skos:altLabel ?other . FILTER(LANG(?other) = "en") }
}`;
}

// The year of a Wikidata time: "-0360-01-01T00:00:00Z" is -360 (360 BC).
function yearOf(time) {
  const [, sign, digits] = String(time).match(/^([+-]?)(\d+)-/) || ['', '', '0'];
  return (sign === '-' ? -1 : 1) * Number(digits);
}

const ordinal = n => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/**
 * A Wikidata date as a person would type it, so the date parser reads it:
 * a year ("1845", "369 BC"), a decade as "c." ("c. 360 BC"), a century
 * ("4th c. BC"). Years before Christ are written without a minus.
 * @param {string} time "-0360-01-01T00:00:00Z"
 * @param {number} precision Wikidata's: 7 century, 8 decade, 9 year, 10 month, 11 day
 * @returns {string} '' when the precision is coarser than a century
 */
export function wikidataDateText(time, precision) {
  const match = String(time).match(/^([+-]?)0*(\d+)-/);
  if (!match || precision < 7) return '';
  const year = Number(match[2]);
  const bc = match[1] === '-' ? ' BC' : '';
  if (precision === 7) return `${ordinal(Math.ceil(year / 100))} c.${bc}`;
  if (precision === 8) return `c. ${year}${bc}`;
  return `${year}${bc}`;
}

// An item's number: Q170583 is 170583. Long-known works got low numbers early on.
const itemNumber = work => Number(work.wikidata.slice(1));

/**
 * Of several dated items with one title and author, the work itself when it
 * clearly stands out, else null. Jane Austen's "Pride and Prejudice" (Q170583,
 * with its original title and other names) beside a 2015 item of the same
 * name (Q108809625): the one with an original title or other names, if it is
 * the only one; otherwise one whose number is under a tenth of every other's.
 */
function clearlyTheWork(dated) {
  const described = dated.filter(work => work.originalTitle || work.otherTitles.size);
  if (described.length === 1) return described[0];
  const [first, ...rest] = [...dated].sort((a, b) => itemNumber(a) - itemNumber(b));
  return rest.every(other => itemNumber(first) * 10 < itemNumber(other)) ? first : null;
}

/**
 * What Wikidata's answer says about each title asked: its item, the earliest
 * date given (written or first published), its original title and its other
 * English titles. A title matching more than one dated work is left out, since
 * Wikidata cannot tell which is meant, unless one clearly stands out (clearlyTheWork).
 * @param {object} answer the query's JSON answer
 * @param {string[]} titles the titles asked (as in worksQuery)
 * @returns {Map<string, { wikidata: string, date: string, originalTitle: string, otherTitles: string[] }>} by the asked title
 */
export function worksFromWikidata(answer, titles) {
  const byLabel = new Map();
  for (const row of (answer && answer.results && answer.results.bindings) || []) {
    const label = row.title.value;
    const id = row.work.value.split('/').pop();
    const works = byLabel.get(label) || new Map();
    const work = works.get(id) || { wikidata: id, dates: [], originalTitle: '', otherTitles: new Set() };
    if (row.time) work.dates.push({ time: row.time.value, precision: Number(row.precision.value) });
    if (row.original) work.originalTitle = row.original.value;
    if (row.other) work.otherTitles.add(row.other.value);
    works.set(id, work);
    byLabel.set(label, works);
  }
  const found = new Map();
  for (const title of titles) {
    const candidates = labelsFor(title).flatMap(label => [...(byLabel.get(label) || new Map()).values()]);
    const dated = candidates.filter(work => work.dates.length);
    const work = dated.length === 1 ? dated[0] : dated.length > 1 ? clearlyTheWork(dated) : candidates.length === 1 ? candidates[0] : null;
    if (!work) continue;
    // The earliest of the dates given: a work's composition comes before its later printings.
    const earliest = work.dates.map(date => ({ ...date, year: yearOf(date.time) })).sort((a, b) => a.year - b.year)[0];
    found.set(title, {
      wikidata: work.wikidata,
      date: earliest ? wikidataDateText(earliest.time, earliest.precision) : '',
      originalTitle: work.originalTitle && work.originalTitle !== title ? work.originalTitle : '',
      otherTitles: [...work.otherTitles].filter(other => other !== title).slice(0, 5),
    });
  }
  return found;
}

// An item's ID, the last part of its address ("…/entity/Q68").
const itemId = address => (String(address).match(/Q\d+$/) || [''])[0];

/**
 * The query that checks stored Wikidata IDs (the laptop's loci-enrich, from
 * time to time): Wikidata merges items, and a merged item points to the one
 * it became; a deleted item answers nothing.
 * @param {string[]} ids "Q1059449"
 * @param {string} [prefixes] the PREFIX lines for owl, wd and wikibase
 */
export function idsQuery(ids, prefixes = '') {
  const valid = ids.filter(id => /^Q\d+$/.test(id));
  if (!valid.length) return '';
  return `${prefixes}
SELECT ?item ?target ?sitelinks WHERE {
  VALUES ?item { ${valid.map(id => `wd:${id}`).join(' ')} }
  OPTIONAL { ?item owl:sameAs ?target }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks }
}`;
}

/**
 * Read the answer to idsQuery: only the IDs that changed.
 * @returns {Map<string, { mergedInto: string } | { missing: true }>} by the ID asked
 */
export function readIdChecks(json, ids) {
  const seen = new Map();
  for (const row of (json && json.results && json.results.bindings) || []) {
    const id = itemId(row.item.value);
    if (row.target) seen.set(id, { mergedInto: itemId(row.target.value) });
    else if (row.sitelinks && !seen.has(id)) seen.set(id, null);
  }
  const changes = new Map();
  for (const id of ids) {
    const seenAs = seen.get(id);
    if (seenAs) changes.set(id, seenAs);
    else if (seenAs === undefined) changes.set(id, { missing: true });
  }
  return changes;
}
