// Small checks for the core tests. They work the same in a browser and in
// Node, so one set of test files serves both (see tests/run.js and the tools
// repository's core.test.mjs).

export function equal(actual, expected, what = 'value') {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function same(actual, expected, what = 'value') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

export function ok(condition, message) {
  if (!condition) throw new Error(message);
}

export function throws(action, what) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error(`${what}: expected an error, but none was thrown`);
}
