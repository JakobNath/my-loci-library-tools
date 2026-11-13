// A copy's binding in three parts (data format 4): the binding itself
// (hardcover, paperback), the material (cloth, leather) and any extras (dust
// jacket, slipcase), each chosen from a list in the shared settings. Also
// reads the free binding text of older records into those parts.

// What older binding text says, in the words of the default lists. Longer
// names come first, so "bonded leather" is not read as "leather".
const READINGS = [
  ['binding', /mass[- ]market( paperback)?/, 'Mass-market paperback'],
  ['binding', /library binding/, 'Library binding'],
  ['binding', /journal issue/, 'Journal issue'],
  ['binding', /paperback|soft ?cover/, 'Paperback'],
  ['binding', /hard ?(cover|back)/, 'Hardcover'],
  ['material', /bonded leather/, 'Bonded leather'],
  ['material', /leather/, 'Leather'],
  ['material', /cloth/, 'Cloth'],
  ['extras', /dust ?jacket/, 'Dust jacket'],
  ['extras', /slip ?case/, 'Slipcase'],
];
// Words that only join the parts: "Hardcover with dust jacket", "Cloth and hardcover in slip case".
const JOINING = /\b(with|and|in|a)\b|[,;+&/]/g;

/**
 * Older binding text read into the three parts. Text that cannot be read
 * wholly (a word left over, or two bindings at once) stays as it was in
 * `binding`, so nothing is lost and nothing is guessed.
 * @param {string|null} text a copy's binding before data format 4
 * @returns {{ binding: string|null, material: string|null, extras: string[] }}
 */
export function readBindingText(text) {
  const parts = { binding: null, material: null, extras: [] };
  let rest = String(text || '').toLowerCase();
  for (const [part, pattern, name] of READINGS) {
    if (!pattern.test(rest)) continue;
    rest = rest.replace(pattern, ' ');
    if (part === 'extras') parts.extras.push(name);
    else if (parts[part]) return { binding: text, material: null, extras: [] };
    else parts[part] = name;
  }
  if (rest.replace(JOINING, ' ').trim()) return { binding: text || null, material: null, extras: [] };
  return parts;
}

/** A copy's binding as one line for screens and exports: "Hardcover · Cloth · Dust jacket". */
export function bindingText(copy) {
  return [copy.binding, copy.material, ...(copy.extras || [])].filter(Boolean).join(' · ');
}

/**
 * The three lists of an older settings.json, whose one bindings list mixed
 * them ("Hardcover with dust jacket", "Leather"): each entry read into its
 * parts, an entry that cannot be read kept as a binding.
 * @param {string[]} oldList
 * @returns {{ bindings: string[], materials: string[], extras: string[] }}
 */
export function sortBindingList(oldList) {
  const lists = { bindings: new Set(), materials: new Set(), extras: new Set() };
  for (const entry of oldList) {
    const parts = readBindingText(entry);
    if (parts.binding) lists.bindings.add(parts.binding);
    if (parts.material) lists.materials.add(parts.material);
    for (const extra of parts.extras) lists.extras.add(extra);
  }
  return { bindings: [...lists.bindings], materials: [...lists.materials], extras: [...lists.extras] };
}
