// Shelf order keys: short texts that sort copies along a shelf. A key can
// always be made between two others, so placing one copy never changes the
// others (DATA_FORMAT.md, "Shelf order").

import { ID_ALPHABET } from './ids.js';

const BASE = ID_ALPHABET.length;

/**
 * A key that sorts after `before` and before `after`.
 * @param {string|null} before the key of the copy to the left, or null at the start
 * @param {string|null} after the key of the copy to the right, or null at the end
 * @returns {string}
 */
export function keyBetween(before, after) {
  const low = before || '';
  if (after !== null && after !== undefined && !(low < after)) {
    throw new Error(`Cannot place a copy between "${before}" and "${after}": they are not in order.`);
  }
  let high = after ?? null;
  let key = '';
  for (let i = 0; ; i++) {
    const lowDigit = i < low.length ? ID_ALPHABET.indexOf(low[i]) : 0;
    const highDigit = high !== null && i < high.length ? ID_ALPHABET.indexOf(high[i]) : BASE;
    if (highDigit - lowDigit > 1) return key + ID_ALPHABET[Math.floor((lowDigit + highDigit) / 2)];
    key += ID_ALPHABET[lowDigit];
    // Once the key is below `high` at this letter, `high` no longer limits the rest.
    if (highDigit - lowDigit === 1) high = null;
  }
}

/**
 * Keys for a whole shelf scanned from left to right, evenly spread and all
 * the same length, so later copies can be placed between any two.
 * @param {number} count
 * @returns {string[]}
 */
export function keysForShelf(count) {
  let length = 1;
  while (BASE ** length < (count + 1) * 4) length++; // leave about four gaps per copy
  const step = Math.floor(BASE ** length / (count + 1));
  const keys = [];
  for (let i = 1; i <= count; i++) {
    let number = step * i;
    let key = '';
    for (let place = 0; place < length; place++) {
      key = ID_ALPHABET[number % BASE] + key;
      number = Math.floor(number / BASE);
    }
    keys.push(key);
  }
  return keys;
}
