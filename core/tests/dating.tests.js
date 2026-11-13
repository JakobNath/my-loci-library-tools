// The date parser: every row of the table in DATA_FORMAT.md, plus the extra
// forms named in PLAN.md, and the historical century convention.

import { parseDating, centurySpan, formatYear, formatYearRange, sortYearOf, workingDating } from '../dating.js';
import { workDateQuestion, translationDateQuestion, webSearchUrl } from '../date-search.js';
import { equal, same, ok } from './check.js';

function reads(text, earliest, latest, certainty) {
  return {
    name: `"${text}" reads as ${earliest} to ${latest}, ${certainty}`,
    fn() {
      const result = parseDating(text);
      ok(result.ok, result.problem);
      same([result.dating.earliest, result.dating.latest, result.dating.certainty], [earliest, latest, certainty], text);
      equal(result.dating.text, text, 'the typed text is kept');
    },
  };
}

export const tests = [
  // The table in PLAN.md and DATA_FORMAT.md
  reads('1689', 1689, 1689, 'exact'),
  reads('c. 397', 397, 397, 'circa'),
  reads('397–400', 397, 400, 'range'),
  reads('1530–59', 1530, 1559, 'range'),
  reads('4th c. BC', -400, -301, 'century'),
  reads('early 2nd c.', 101, 133, 'century'),
  reads('after 1517', 1517, null, 'open'),
  // Extra forms
  reads('4th–5th c.', 301, 500, 'century'),
  reads('mid-3rd c.', 234, 266, 'century'),
  reads('late 5th c.', 467, 500, 'century'),
  reads('397/398', 397, 398, 'range'),
  reads('c. 1200 BC', -1200, -1200, 'circa'),
  reads('fl. 1150', 1150, 1150, 'circa'),
  reads('before 1517', null, 1517, 'open'),
  reads('1554–', 1554, null, 'open'),
  reads('c. 50–70', 50, 70, 'circa'),
  reads('1565-73', 1565, 1573, 'range'),
  reads('1849 to 1850', 1849, 1850, 'range'),
  reads('500–450 BC', -500, -450, 'range'),
  reads('late 4th–early 5th c.', 367, 433, 'century'),
  reads('5th century', 401, 500, 'century'),
  reads('AD 397', 397, 397, 'exact'),
  reads('c. 1418–27', 1418, 1427, 'circa'),
  {
    name: 'the 2nd century is 101 to 200, and there is no year 0',
    fn() {
      same(centurySpan(2, null, false), { earliest: 101, latest: 200 });
      same(centurySpan(1, null, true), { earliest: -100, latest: -1 });
      same(centurySpan(1, null, false), { earliest: 1, latest: 100 });
    },
  },
  {
    name: 'early, mid and late are thirds of a century',
    fn() {
      same(centurySpan(2, 'early', false), { earliest: 101, latest: 133 });
      same(centurySpan(2, 'mid', false), { earliest: 134, latest: 166 });
      same(centurySpan(2, 'late', false), { earliest: 167, latest: 200 });
    },
  },
  {
    name: 'nonsense and year 0 are refused with a helpful message',
    fn() {
      for (const text of ['', 'sometime', '0', '400–300']) {
        const result = parseDating(text);
        ok(!result.ok, `"${text}" should be refused`);
        ok(result.problem.includes('Forms that work'), 'the message suggests forms');
      }
    },
  },
  {
    name: 'years are written as AD/BC or CE/BCE',
    fn() {
      equal(formatYear(-400), '400 BC');
      equal(formatYear(-400, 'CE'), '400 BCE');
      equal(formatYear(397), '397');
      equal(formatYearRange(-400, -301), '400–301 BC');
      equal(formatYearRange(397, 400), '397–400');
      equal(formatYearRange(1517, null), 'after 1517');
      equal(formatYearRange(-50, 70), '50 BC – AD 70');
      equal(formatYearRange(-50, 70, 'CE'), '50 BCE – 70 CE');
    },
  },
  {
    name: 'a disputed work sorts by its working dating (the Didache)',
    fn() {
      const didache = {
        sortYear: null,
        datings: [
          { text: 'c. 50–70', earliest: 50, latest: 70, certainty: 'circa', working: false },
          { text: 'c. 100–120', earliest: 100, latest: 120, certainty: 'circa', working: true },
        ],
      };
      equal(workingDating(didache).text, 'c. 100–120');
      equal(sortYearOf(didache), 100);
    },
  },
  {
    name: 'a sort year chosen by a person overrides the dating (Loci Theologici)',
    fn() {
      const loci = { sortYear: 1554, datings: [{ text: '1591', earliest: 1591, latest: 1591, certainty: 'exact', working: true }] };
      equal(sortYearOf(loci), 1554);
    },
  },
  {
    name: 'a work with no dating has no sort year',
    fn() {
      equal(sortYearOf({ sortYear: null, datings: [] }), null);
    },
  },
  {
    name: 'a span from BC into AD reads with an era on each side: "43 BC – 17", "27 BC – AD 9"',
    fn() {
      same(parseDating('43 BC – 17').dating, { text: '43 BC – 17', earliest: -43, latest: 17, certainty: 'range' });
      same([parseDating('27 BC – AD 9').dating.earliest, parseDating('27 BC – AD 9').dating.latest], [-27, 9]);
      same([parseDating('c. 4 BC - 65').dating.earliest, parseDating('c. 4 BC - 65').dating.certainty], [-4, 'circa']);
    },
  },
  // "Search the web" beside a date box (PLAN.md, "Original dates")
  {
    name: 'a work with an author is asked about by title and author',
    fn() { equal(workDateQuestion('Pride and Prejudice', ['Jane Austen']), 'When was Pride and Prejudice by Jane Austen written and first published?'); },
  },
  {
    name: 'a work with no author is asked about as "the" work',
    fn() {
      equal(workDateQuestion('Didache', []), 'When was the Didache written and first published?');
      equal(workDateQuestion('The Epic of Gilgamesh', []), 'When was The Epic of Gilgamesh written and first published?');
    },
  },
  {
    name: 'several authors are joined with "and"',
    fn() { equal(workDateQuestion('Good Omens', ['Terry Pratchett', 'Neil Gaiman']), 'When was Good Omens by Terry Pratchett and Neil Gaiman written and first published?'); },
  },
  {
    name: 'a translation is asked about by its translator',
    fn() {
      equal(translationDateQuestion('The Odyssey', ['Robert Fagles']), "When was Robert Fagles' translation of The Odyssey first published?");
      equal(translationDateQuestion('Confessions', ['Henry Chadwick']), "When was Henry Chadwick's translation of Confessions first published?");
      equal(translationDateQuestion('The Iliad', []), 'When was the English translation of The Iliad first published?');
    },
  },
  {
    name: 'the search address carries the question, encoded',
    fn() { equal(webSearchUrl("When was Fagles' Iliad & Odyssey?"), "https://www.google.com/search?q=When%20was%20Fagles'%20Iliad%20%26%20Odyssey%3F"); },
  },
];
