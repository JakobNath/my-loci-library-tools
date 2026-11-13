// The "Search the web" link beside a date box: a question worded so that a
// web search answers it without editing (PLAN.md, "Original dates", "Search
// the web"). Only the address is built here; the browser does the search.

// The one place the search address lives. If it ever changes, change it here.
const SEARCH_ADDRESS = 'https://www.google.com/search?q=';

const ARTICLE = /^(the|a|an)\s/i;

// "Plato", "Plato and Aristotle", "Plato, Aristotle and Cicero".
function namesText(names) {
  const list = names.map(name => String(name || '').trim()).filter(Boolean);
  if (list.length < 2) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The question asked about a work's original date. It asks for both the
 * written and the published date, which the working-date rule needs.
 * @param {string} title the work's title, as the catalog gives it
 * @param {string[]} authorNames its authors' names (may be empty)
 * @returns {string} "When was Pride and Prejudice by Jane Austen written and first published?"
 */
export function workDateQuestion(title, authorNames) {
  const name = String(title || '').trim();
  const authors = namesText(authorNames || []);
  // A work with no author is usually named with "the" (the Didache), unless its title has an article already.
  const subject = authors ? `${name} by ${authors}` : ARTICLE.test(name) ? name : `the ${name}`;
  return `When was ${subject} written and first published?`;
}

/**
 * The question asked about when a translation first appeared.
 * @param {string} title the book's title
 * @param {string[]} translatorNames who translated it (may be empty)
 * @returns {string} "When was Robert Fagles' translation of The Odyssey first published?"
 */
export function translationDateQuestion(title, translatorNames) {
  const name = String(title || '').trim();
  const translators = namesText(translatorNames || []);
  if (!translators) return `When was the English translation of ${name} first published?`;
  // English possessive: "Fagles'", but "Lattimore's".
  const possessive = translators.endsWith('s') ? `${translators}'` : `${translators}'s`;
  return `When was ${possessive} translation of ${name} first published?`;
}

/**
 * The web address that searches for a question.
 * @param {string} question
 * @returns {string}
 */
export function webSearchUrl(question) {
  return SEARCH_ADDRESS + encodeURIComponent(question);
}
