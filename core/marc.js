// Reading a Library of Congress catalog record (MARC 21, as MARC XML) into
// our fields. The record is fetched by the laptop tool loci-enrich; this file
// only reads the text, so it is tested with recorded answers. The meaning of
// each numbered field is in the Library of Congress's "MARC 21 Format for
// Bibliographic Data" (https://www.loc.gov/marc/bibliographic/).

import { isbn13 } from './entry.js';
import { emptyFound, contributorsFrom, cleanPages, sentenceToTitleCase, tidy, yearOf } from './lookup.js';
import { LANGUAGE_NAMES, isWorkTitle } from './book-data.js';

// Uniform titles that name a kind of collection, not an original title.
const COLLECTIVE_TITLES = new Set(['works', 'selections', 'selected works', 'novels', 'poems', 'plays', 'short stories', 'correspondence', 'letters', 'sermons']);

const decode = text => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (whole, code) => String.fromCodePoint(Number(code))).replace(/&amp;/g, '&');

/**
 * The records in a catalog answer, each a list of fields:
 * { tag, ind1, ind2, subfields: [[code, text], ...] } (control fields have `text` instead).
 */
export function marcRecords(xml) {
  const records = [];
  for (const [record] of String(xml || '').matchAll(/<record[\s>][\s\S]*?<\/record>/g)) {
    const fields = [];
    for (const [, tag, text] of record.matchAll(/<controlfield tag="(\d+)">([^<]*)<\/controlfield>/g)) fields.push({ tag, text: decode(text) });
    for (const [, tag, ind1, ind2, body] of record.matchAll(/<datafield tag="(\d+)" ind1="(.)" ind2="(.)">([\s\S]*?)<\/datafield>/g)) {
      const subfields = [...body.matchAll(/<subfield code="(.)">([^<]*)<\/subfield>/g)].map(([, code, text]) => [code, decode(text)]);
      fields.push({ tag, ind1, ind2, subfields });
    }
    records.push(fields);
  }
  return records;
}

const fieldsOf = (record, tag) => record.filter(field => field.tag === tag && field.subfields);
const subfield = (field, code) => (field && (field.subfields.find(([name]) => name === code) || [])[1]) || '';
const allSubfields = (field, code) => (field ? field.subfields.filter(([name]) => name === code).map(([, text]) => text) : []);

// Without catalogue punctuation at the end of a subfield (" /", " :", " ;",
// ",", "=") and square brackets (text a cataloguer supplied): "[Rev. ed.]."
// is "Rev. ed.". Places, publishers and edition statements keep their closing
// full stop, which there always ends an abbreviation ("Indianapolis, Ind.").
const plain = text => tidy(text).replace(/[[\]]/g, '').replace(/\s*[/:;,=]$/, '').trim().replace(/\.\.$/, '.');

// As plain, and without the full stop that closes a title, name or heading,
// unless it ends an initial or a short abbreviation ("C. S.", "ed.").
function withoutStop(text) {
  const clean = plain(text);
  return /\.$/.test(clean) && !/(\b[A-Za-z]{1,3}|\.\w)\.$/.test(clean) ? clean.slice(0, -1) : clean;
}

// "Dostoyevsky, Fyodor," is Fyodor Dostoyevsky; "Plato." and "Augustine, of Hippo" read as they stand.
function personName(field) {
  const name = withoutStop(subfield(field, 'a'));
  const inverted = field.ind1 === '1' && name.includes(',');
  const whole = inverted ? `${name.slice(name.indexOf(',') + 1).trim()} ${name.slice(0, name.indexOf(','))}` : name;
  const title = withoutStop(subfield(field, 'c'));
  return /^of\b/.test(title) ? `${whole} ${title.split(',')[0]}` : whole;
}

const RELATORS = { trl: 'translator', translator: 'translator', edt: 'editor', editor: 'editor', aui: 'introduction',
  'author of introduction': 'introduction', 'writer of introduction': 'introduction', ill: 'illustrator', illustrator: 'illustrator' };

// People named in 700 fields with a relator ("$e translator" or "$4 trl"), when the title statement did not name them.
function relatedPeople(record, known) {
  const people = [];
  for (const field of fieldsOf(record, '700')) {
    const relators = [...allSubfields(field, 'e'), ...allSubfields(field, '4')].map(text => withoutStop(text).toLowerCase());
    const role = relators.map(relator => RELATORS[relator]).find(Boolean);
    const name = personName(field);
    const surname = name.split(' ').pop().toLowerCase();
    if (role && !known.some(person => person.name.toLowerCase().endsWith(surname))) people.push({ name, role });
  }
  return people;
}

// "B358 .C3 1997", "891.73/3" (the slash only marks where a library may shorten it).
const callNumber = field => tidy(`${subfield(field, 'a')} ${subfield(field, 'b')}`);

function subjectHeading(field) {
  const main = field.subfields.filter(([code]) => !'vxyz0123456789'.includes(code)).map(([, text]) => text).join(' ');
  const parts = [main, ...field.subfields.filter(([code]) => 'vxyz'.includes(code)).map(([, text]) => text)];
  return parts.map(part => withoutStop(part).replace(/,$/, '')).filter(Boolean).join(' -- ');
}

// The contents note (505): "First Clement -- Second Clement -- ..." or, in its
// fuller form, titles ($t) with their authors ($r).
function contentsOf(record) {
  const contents = [];
  for (const field of fieldsOf(record, '505')) {
    const titles = allSubfields(field, 't');
    if (titles.length) {
      field.subfields.forEach(([code, text], i) => {
        if (code !== 't') return;
        const next = field.subfields[i + 1];
        contents.push({ title: sentenceToTitleCase(withoutStop(text.replace(/\s*--\s*$/, ''))), author: next && next[0] === 'r' ? withoutStop(next[1].replace(/\s*--\s*$/, '')) : '' });
      });
    } else {
      for (const part of subfield(field, 'a').split(/\s+--\s+/)) {
        const [title, author = ''] = part.split(' / ');
        if (withoutStop(title)) contents.push({ title: sentenceToTitleCase(withoutStop(title)), author: withoutStop(author) });
      }
    }
  }
  return contents.filter(entry => isWorkTitle(entry.title));
}

// A volume number or Roman numeral as a number, for comparing "2", "II" and "ii".
const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function labelValue(label) {
  const text = String(label).toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  if (!/^[ivxlc]+$/.test(text)) return null;
  let total = 0;
  for (let i = 0; i < text.length; i++) {
    const value = ROMAN[text[i]];
    total += value < (ROMAN[text[i + 1]] || 0) ? -value : value;
  }
  return total;
}

// The volume an ISBN's note names: "(v. 1)", "v.2", "vol. III"; empty when it names none ("(hardcover)").
const volumeInNote = note => (String(note).match(/\bv(?:ol)?\.?\s*(\d+|[ivxlc]+)\b/i) || ['', ''])[1];

// The digits of a catalogue number, for comparing "  2003032744 " and "(OCoLC)56058333" with typed ones.
const digitsOf = text => String(text || '').replace(/\D/g, '');

// The records listing the ISBN, each with the volume its ISBN note names. A
// book without an ISBN is found by its LCCN or OCLC number instead ({ lccn, oclc }).
function recordsListing(records, isbn) {
  const listing = [];
  if (typeof isbn === 'object' && isbn) {
    const lccn = digitsOf(isbn.lccn);
    const oclc = digitsOf(isbn.oclc);
    for (const fields of records) {
      const hasLccn = lccn && fieldsOf(fields, '010').some(field => digitsOf(subfield(field, 'a')) === lccn);
      const hasOclc = oclc && fieldsOf(fields, '035').some(field => /^\(OCoLC\)/.test(subfield(field, 'a')) && digitsOf(subfield(field, 'a')) === oclc);
      if (hasLccn || hasOclc) listing.push({ fields, volume: '' });
    }
    return listing;
  }
  for (const fields of records) {
    for (const field of fieldsOf(fields, '020')) {
      const [number, ...rest] = subfield(field, 'a').split(' ');
      if (isbn13(number) !== isbn) continue;
      listing.push({ fields, volume: volumeInNote([...rest, ...allSubfields(field, 'q')].join(' ')) });
      break;
    }
  }
  return listing;
}

/**
 * The record to read for an ISBN: one for that book alone if there is one,
 * else a record for a whole set naming the ISBN's volume ("Plato in twelve
 * volumes", ISBN "(v. 1)"). Null when no record lists the ISBN, or when
 * records of different books share it (Great Books of the Western World
 * prints one ISBN on every volume): then nothing can be told about the book.
 */
function chooseRecord(records, isbn) {
  const listing = recordsListing(records, isbn);
  const own = listing.filter(item => !item.volume);
  // Titles compared by their letters only: "Euthyphro, Apology…" and "Euthyphro ; Apology…" are one book.
  const titleOf = item => subfield(fieldsOf(item.fields, '245')[0], 'a').toLowerCase().replace(/[^a-z]/g, '');
  if (new Set(own.map(titleOf)).size > 2) return null;
  return own[0] || listing[0] || null;
}

// A record describing a set: "12 v.", "2 volumes", or "v." for an open set.
const describesSet = record => /^\s*(?:\d+\s*)?v\.|\bvolumes\b/i.test(subfield(fieldsOf(record, '300')[0], 'a'));

// A 505 section's leading volume label: "1. ", "[v. 1] ", "I. ", "V-VI. ", "v. 2. ", "[v.] 1. ".
const SECTION_VOLUME = /^\s*(?:\[?v(?:ol)?s?\.?\]?\s*)?\[?(\d+|[IVXLC]+)(?:\s*-\s*(\d+|[IVXLC]+))?\s*[.\]]\s+/i;

// One section of a set's contents, read as works: "I Clement. II Clement. Ignatius."
// is three works when every piece is a short title; otherwise the section is one work.
function sectionWorks(section) {
  const text = section.replace(/\[[^\]]*\]/g, '').trim();
  const pieces = text.split(/\.\s+(?=\S)/).map(piece => withoutStop(piece)).filter(Boolean);
  const titles = pieces.length > 1 && pieces.every(piece => /^[A-Z0-9]/.test(piece) && piece.split(' ').length <= 8) ? pieces : [withoutStop(text)];
  return titles.map(title => {
    const [name, author = ''] = title.split(' / ');
    return { title: sentenceToTitleCase(withoutStop(name)), author: withoutStop(author) };
  });
}

// The works of one volume, from a set record's contents note. Sections are
// split by " -- "; a section starting with a volume label begins that
// volume, and those after it belong to it until the next label.
function volumeContents(record, volume) {
  const wanted = labelValue(volume);
  const contents = [];
  let current = null;
  for (const field of fieldsOf(record, '505')) {
    for (const section of subfield(field, 'a').split(/\s*--\s*/)) {
      const label = section.match(SECTION_VOLUME);
      if (label) current = [labelValue(label[1]), labelValue(label[2] || label[1])];
      if (current && wanted !== null && wanted >= current[0] && wanted <= current[1]) contents.push(...sectionWorks(label ? section.slice(label[0].length) : section));
    }
  }
  return contents.filter(entry => entry.title && isWorkTitle(entry.title));
}

// A book whose title is a list of short titles ("Euthyphro, Apology, Crito, Phaedo, Phaedrus") holds those works.
function contentsInTitle(title) {
  const parts = title.split(/\s*[,;]\s*/).filter(Boolean);
  return parts.length >= 3 && parts.every(part => /^[A-Z]/.test(part) && part.split(' ').length <= 4 && !/\band\b/.test(part))
    ? parts.map(part => ({ title: part, author: '' })) : [];
}

/**
 * Read a Library of Congress answer (SRU, MARC XML) for one ISBN. Only a
 * record that lists the book's own ISBN is read: the catalog sometimes
 * answers with other books too. Original dates are never read.
 * @param {string} xml the whole answer
 * @param {string|{ lccn?: string, oclc?: string }} isbn 13 digits; or, for a book without one, its LCCN or OCLC number
 * @returns {import('./lookup.js').Found|null} null when no record lists the ISBN
 */
export function fromLibraryOfCongress(xml, isbn) {
  return fromMarc(xml, isbn, 'libraryofcongress');
}

/**
 * Read HathiTrust's answer (its Bibliographic API, "full", as JSON holding
 * each record's MARC XML) for one ISBN, as for the Library of Congress. Its
 * records come from university libraries, many copied from the Library of
 * Congress; it holds only books those libraries have scanned (SOURCES.md).
 * @param {string} text the whole answer
 * @param {string|{ lccn?: string, oclc?: string }} isbn 13 digits, or an LCCN or OCLC number (as for fromLibraryOfCongress)
 * @returns {import('./lookup.js').Found|null}
 */
export function fromHathiTrust(text, isbn) {
  let answer;
  try { answer = JSON.parse(text); } catch { return null; }
  const xml = Object.values((answer && answer.records) || {}).map(record => record['marc-xml'] || '').join('');
  return fromMarc(xml, isbn, 'hathitrust');
}

/**
 * One book's fields from MARC records. A record for a whole set gives the
 * set's title as `set`, the ISBN's volume as `volume`, and that volume's
 * works only; its title and pages describe the set, so they are left empty
 * for another source (or mergeFound) to give.
 */
function fromMarc(xml, isbn, source) {
  const chosen = chooseRecord(marcRecords(xml), isbn);
  if (!chosen) return null;
  const record = chosen.fields;
  const isSet = Boolean(chosen.volume) && describesSet(record);
  const found = emptyFound(source);
  const field = tag => fieldsOf(record, tag)[0];
  const titleField = field('245');
  found.isbn = typeof isbn === 'string' ? isbn : '';
  found.title = sentenceToTitleCase(withoutStop([subfield(titleField, 'a'), ...allSubfields(titleField, 'n'), ...allSubfields(titleField, 'p')].join(' ')));
  found.subtitle = sentenceToTitleCase(withoutStop(subfield(titleField, 'b')));
  found.authors = fieldsOf(record, '100').map(personName);
  found.contributors = contributorsFrom(subfield(titleField, 'c'));
  found.contributors.push(...relatedPeople(record, found.contributors));
  const imprint = fieldsOf(record, '264').find(item => item.ind2 === '1') || field('260');
  found.place = plain(subfield(imprint, 'a')).replace(/^S\.\s?l\.?$/i, '');
  found.publisher = plain(subfield(imprint, 'b')).replace(/\bPub\.(?=\s|$)/, 'Publishing').replace(/^publisher not identified$/i, '');
  found.year = yearOf(subfield(imprint, 'c'));
  found.editionStatement = plain(subfield(field('250'), 'a'));
  const seriesField = field('490') || field('440') || field('830');
  found.series = sentenceToTitleCase(withoutStop(subfield(seriesField, 'a')));
  found.seriesNumber = plain(subfield(seriesField, 'v')).replace(/^(?:v|vol|no|nr|bd|t)\.?\s*/i, '');
  const description = field('300');
  // A record for a whole set gives its number of volumes ("2 v."), not pages.
  found.pages = describesSet(record) ? '' : cleanPages(subfield(description, 'a'));
  found.height = heightInMm(subfield(description, 'c'));
  const uniform = withoutStop(subfield(field('240'), 'a'));
  const isCollective = COLLECTIVE_TITLES.has(uniform.toLowerCase());
  found.originalTitle = uniform && !isCollective && uniform.toLowerCase() !== found.title.toLowerCase() ? uniform : '';
  const languages = field('041');
  const original = languages && languages.ind1 === '1' ? subfield(languages, 'h') : '';
  found.originalLanguage = original ? LANGUAGE_NAMES[original] || original : '';
  found.contents = isSet ? volumeContents(record, chosen.volume) : contentsOf(record);
  if (!isSet && !found.contents.length) found.contents = contentsInTitle(found.title);
  // A work listed without its author is by the book's author, when it has one (Plato's dialogues).
  if (found.authors.length === 1) found.contents = found.contents.map(entry => ({ ...entry, author: entry.author || found.authors[0] }));
  if (isSet) {
    found.set = found.title;
    found.volume = chosen.volume;
    found.title = '';
    found.subtitle = '';
    if (/[,–-]/.test(found.seriesNumber)) found.seriesNumber = ''; // the set's numbers, "36, 123, 164-167"
  }
  found.subjects = [...new Set(record.filter(item => /^6(00|10|11|30|50|51)$/.test(item.tag) && item.ind2 === '0').map(subjectHeading))];
  found.identifiers = {
    lccn: tidy(subfield(field('010'), 'a')),
    oclc: ((fieldsOf(record, '035').map(item => subfield(item, 'a')).find(text => text.startsWith('(OCoLC)')) || '').match(/\d+/) || [''])[0],
    lcc: field('050') ? callNumber(field('050')) : '',
    ddc: subfield(field('082'), 'a').replace(/\//g, ''),
    openLibrary: '',
    // HathiTrust's own record number is the record's control number (001); it gives the link to a free scan.
    hathiTrust: source === 'hathitrust' ? tidy((record.find(item => item.tag === '001') || {}).text) : '',
  };
  return found;
}

/**
 * A height in millimeters from a catalog's physical description: "24 cm."
 * is 240. Library heights are whole centimeters, rounded up; "24 x 30 cm" is
 * height first.
 * @returns {number|null}
 */
export function heightInMm(text) {
  const match = String(text || '').match(/(\d+(?:\.\d+)?)\s*(?:x\s*\d+(?:\.\d+)?\s*)?cm/);
  return match ? Math.round(Number(match[1]) * 10) : null;
}
