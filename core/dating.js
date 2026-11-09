// Reading and writing original dates ("datings") of works. The forms a
// scholar types, and how each is read, are listed in DATA_FORMAT.md under
// "Datings". BC years are negative and there is no year 0.

const CENTURY_WORD = '(?:c\\.?|cent\\.?|century)';
const THIRD = '(early|mid|late)?\\s*-?\\s*';
const ORDINAL = '(\\d{1,2})(?:st|nd|rd|th)';

/**
 * Read a typed dating.
 * @param {string} text what a person typed, e.g. "c. 397–400" or "early 2nd c."
 * @returns {{ ok: true, dating: { text: string, earliest: number|null, latest: number|null, certainty: string } }
 *   | { ok: false, problem: string }}
 */
export function parseDating(text) {
  const original = String(text ?? '').trim();
  if (!original) return failure(original);
  let rest = original.toLowerCase()
    .replace(/[‒–—−]/g, '-') // all dashes become a hyphen
    .replace(/\s+to\s+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  // The era, written once at the end, applies to the whole dating.
  let isBc = false;
  const era = rest.match(/\s*\b(b\.?\s?c\.?\s?e?\.?|a\.?\s?d\.?|c\.?\s?e\.?)$/);
  if (era && /\d|c\.?$|century$/.test(rest.slice(0, era.index))) {
    isBc = era[1].startsWith('b');
    rest = rest.slice(0, era.index).trim();
  }

  // "AD 397": AD may also be written first.
  rest = rest.replace(/^a\.?\s?d\.?\s+/, '');

  let certainty = null;
  const prefix = rest.match(/^(c\.|ca\.|circa|fl\.|after|before)\s*/);
  if (prefix) {
    certainty = { 'c.': 'circa', 'ca.': 'circa', circa: 'circa', 'fl.': 'circa', after: 'after', before: 'before' }[prefix[1]];
    rest = rest.slice(prefix[0].length);
  }
  // "1554–": from a year on, with no end, is the same as "after 1554".
  if (/^\d{1,4}\s*-$/.test(rest)) {
    certainty = 'after';
    rest = rest.replace(/\s*-$/, '');
  }

  const read = readCenturies(rest, isBc) || readYears(rest, isBc);
  if (!read) return failure(original);
  let { earliest, latest } = read;
  let kind = read.isCentury ? 'century' : earliest === latest ? 'exact' : 'range';
  if (certainty === 'circa') kind = 'circa';
  if (certainty === 'after') { latest = null; kind = 'open'; }
  if (certainty === 'before') { earliest = null; kind = 'open'; }
  if (earliest !== null && latest !== null && earliest > latest) return failure(original);
  return { ok: true, dating: { text: original, earliest, latest, certainty: kind } };
}

function failure(text) {
  return {
    ok: false,
    problem: `Could not read "${text}" as a date. Forms that work: 1689, c. 397, 397–400, 4th c. BC, early 2nd c., after 1517.`,
  };
}

// "4th c.", "early 2nd c.", "4th–5th c.", "late 4th–early 5th c."
function readCenturies(text, isBc) {
  const one = new RegExp(`^${THIRD}${ORDINAL}\\s*${CENTURY_WORD}$`);
  const two = new RegExp(`^${THIRD}${ORDINAL}(?:\\s*${CENTURY_WORD})?\\s*-\\s*${THIRD}${ORDINAL}\\s*${CENTURY_WORD}$`);
  let match = text.match(one);
  if (match) {
    const span = centurySpan(Number(match[2]), match[1], isBc);
    return span && { ...span, isCentury: true };
  }
  match = text.match(two);
  if (match) {
    const first = centurySpan(Number(match[2]), match[1], isBc);
    const second = centurySpan(Number(match[4]), match[3], isBc);
    if (!first || !second) return null;
    return { earliest: Math.min(first.earliest, second.earliest), latest: Math.max(first.latest, second.latest), isCentury: true };
  }
  return null;
}

/**
 * The years of a century, or of its early, middle or late third.
 * The 2nd century is 101–200; the 4th century BC is 400–301 BC (-400 to -301).
 */
export function centurySpan(century, third, isBc) {
  if (!century || century < 1) return null;
  const start = isBc ? -century * 100 : (century - 1) * 100 + 1;
  const end = start + 99;
  // Thirds: 33, 33 and 34 years, so the 2nd century is 101–133, 134–166, 167–200.
  if (third === 'early') return { earliest: start, latest: start + 32 };
  if (third === 'mid') return { earliest: start + 33, latest: start + 65 };
  if (third === 'late') return { earliest: start + 66, latest: end };
  return { earliest: start, latest: end };
}

// "1689", "397-400", "1530-59", "397/398", "500-450" (BC)
function readYears(text, isBc) {
  const match = text.match(/^(\d{1,4})(?:\s*[-/]\s*(\d{1,4}))?$/);
  if (!match) return null;
  const first = Number(match[1]);
  let second = match[2] === undefined ? first : Number(match[2]);
  // "1530-59": the second year borrows the first year's leading digits.
  if (match[2] && match[2].length < match[1].length && second < first) {
    const borrowed = Number(match[1].slice(0, match[1].length - match[2].length) + match[2]);
    if (borrowed >= first) second = borrowed;
  }
  if (first === 0 || second === 0) return null;
  if (isBc) {
    // BC ranges are written from the older year: "500-450 BC".
    return { earliest: -Math.max(first, second), latest: -Math.min(first, second) };
  }
  return { earliest: first, latest: second };
}

/**
 * Write one year for display.
 * @param {number} year negative for BC
 * @param {'AD'|'CE'} style
 */
export function formatYear(year, style = 'AD') {
  if (year < 0) return `${-year} ${style === 'CE' ? 'BCE' : 'BC'}`;
  return String(year);
}

/**
 * Write a span of years for display: "397–400", "400–301 BC", "50 BC – 70".
 * An era is added to positive years only when the span starts in BC.
 */
export function formatYearRange(earliest, latest, style = 'AD') {
  if (earliest === null && latest === null) return '';
  if (earliest === null) return 'before ' + formatYear(latest, style);
  if (latest === null) return 'after ' + formatYear(earliest, style);
  if (earliest === latest) return formatYear(earliest, style);
  if (earliest < 0 && latest < 0) return `${-earliest}–${-latest} ${style === 'CE' ? 'BCE' : 'BC'}`;
  if (earliest < 0) return `${formatYear(earliest, style)} – ${style === 'CE' ? '' : 'AD '}${latest}${style === 'CE' ? ' CE' : ''}`;
  return `${earliest}–${latest}`;
}

/** The working dating of a work: the one marked working, or else the first. */
export function workingDating(work) {
  const datings = work.datings || [];
  return datings.find(dating => dating.working) || datings[0] || null;
}

/**
 * The year a work sorts by: its own sort year if a person set one, else the
 * earliest year of its working dating (or the latest, for "before" datings).
 * @returns {number|null}
 */
export function sortYearOf(work) {
  if (typeof work.sortYear === 'number') return work.sortYear;
  const dating = workingDating(work);
  if (!dating) return null;
  return dating.earliest ?? dating.latest;
}
