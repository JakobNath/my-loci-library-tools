// Reading a Library of Congress catalog record (MARC 21, as MARC XML) into
// our fields. The record is fetched by the laptop tool loci-enrich; this file
// only reads the text, so it is tested with recorded answers. The meaning of
// each numbered field is in the Library of Congress's "MARC 21 Format for
// Bibliographic Data" (https://www.loc.gov/marc/bibliographic/).

import { isbn13 } from './entry.js';
import { emptyFound, contributorsFrom, cleanPages, sentenceToTitleCase, tidy, yearOf } from './lookup.js';
import { LANGUAGE_NAMES } from './book-data.js';

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
  return contents;
}

/**
 * Read a Library of Congress answer (SRU, MARC XML) for one ISBN. Only a
 * record that lists the book's own ISBN is read: the catalog sometimes
 * answers with other books too. Original dates are never read.
 * @param {string} xml the whole answer
 * @param {string} isbn 13 digits
 * @returns {import('./lookup.js').Found|null} null when no record lists the ISBN
 */
export function fromLibraryOfCongress(xml, isbn) {
  const record = marcRecords(xml).find(fields => fieldsOf(fields, '020').some(field => isbn13(subfield(field, 'a').split(' ')[0]) === isbn));
  if (!record) return null;
  const found = emptyFound('libraryofcongress');
  const field = tag => fieldsOf(record, tag)[0];
  const titleField = field('245');
  found.isbn = isbn;
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
  found.pages = cleanPages(subfield(description, 'a'));
  found.height = heightInMm(subfield(description, 'c'));
  const uniform = withoutStop(subfield(field('240'), 'a'));
  const isCollective = COLLECTIVE_TITLES.has(uniform.toLowerCase());
  found.originalTitle = uniform && !isCollective && uniform.toLowerCase() !== found.title.toLowerCase() ? uniform : '';
  const languages = field('041');
  const original = languages && languages.ind1 === '1' ? subfield(languages, 'h') : '';
  found.originalLanguage = original ? LANGUAGE_NAMES[original] || original : '';
  found.contents = contentsOf(record);
  found.subjects = [...new Set(record.filter(item => /^6(00|10|11|30|50|51)$/.test(item.tag) && item.ind2 === '0').map(subjectHeading))];
  found.identifiers = {
    lccn: tidy(subfield(field('010'), 'a')),
    oclc: ((fieldsOf(record, '035').map(item => subfield(item, 'a')).find(text => text.startsWith('(OCoLC)')) || '').match(/\d+/) || [''])[0],
    lcc: field('050') ? callNumber(field('050')) : '',
    ddc: subfield(field('082'), 'a').replace(/\//g, ''),
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
