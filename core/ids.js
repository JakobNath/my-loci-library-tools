// Record and image IDs: 12 characters from a 32-letter alphabet that leaves
// out i, l, o and u, so IDs are easy to read aloud. See DATA_FORMAT.md, "IDs".
// Core takes the random bytes as an argument; it never makes randomness itself.

export const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
export const ID_LENGTH = 12;

/**
 * Make an ID from random bytes.
 * @param {Uint8Array} randomBytes at least 12 random bytes, e.g. from crypto.getRandomValues
 * @returns {string}
 */
export function makeId(randomBytes) {
  if (!randomBytes || randomBytes.length < ID_LENGTH) {
    throw new Error('makeId needs at least ' + ID_LENGTH + ' random bytes.');
  }
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    // 256 is a multiple of 32, so taking the remainder keeps every letter equally likely.
    id += ID_ALPHABET[randomBytes[i] % 32];
  }
  return id;
}

/** Whether a text has the shape of an ID. */
export function isId(text) {
  if (typeof text !== 'string' || text.length !== ID_LENGTH) return false;
  for (const letter of text) {
    if (!ID_ALPHABET.includes(letter)) return false;
  }
  return true;
}
