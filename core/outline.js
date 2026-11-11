// The outline in the photo editor: where it starts, how a spine's edge
// moves when dragged, and where the magnifiers sit. Pure geometry on
// [x, y] points in the photo's own pixels; the editor (ui/photo-editor.js)
// draws it and handles the finger.

/** Edges by their two corners, in order: top, right, bottom, left. */
export const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0]];

/**
 * The outline a photo starts with: inset for a cover, a tall narrow band
 * for a spine. Corners run top left, top right, bottom right, bottom left.
 * @param {number} width
 * @param {number} height
 * @param {'cover'|'spine'} kind
 * @returns {number[][]}
 */
export function startingOutline(width, height, kind) {
  if (kind === 'spine') {
    const half = width * 0.09;
    return [[width / 2 - half, height * 0.05], [width / 2 + half, height * 0.05], [width / 2 + half, height * 0.95], [width / 2 - half, height * 0.95]];
  }
  return [[width * 0.1, height * 0.08], [width * 0.9, height * 0.08], [width * 0.9, height * 0.92], [width * 0.1, height * 0.92]];
}

const lengthOf = (outline, [i, j]) => Math.hypot(outline[j][0] - outline[i][0], outline[j][1] - outline[i][1]);

/**
 * Which part of a spine's outline a press at `point` takes hold of: the
 * nearest edge, and which of its corners move. The middle of an edge moves
 * both its corners; the outer quarter of one of the two long edges moves only
 * that end, which is how a spine photographed at a slant is lined up.
 * @param {number[][]} outline
 * @param {number[]} point
 * @returns {{ edge: number, corners: number[], distance: number }}
 */
export function spineGrip(outline, point) {
  const longest = Math.max(...EDGES.map(edge => lengthOf(outline, edge)));
  let best = null;
  EDGES.forEach(([i, j], edge) => {
    const [ax, ay] = outline[i];
    const ex = outline[j][0] - ax;
    const ey = outline[j][1] - ay;
    const along = Math.min(1, Math.max(0, ((point[0] - ax) * ex + (point[1] - ay) * ey) / (ex * ex + ey * ey || 1)));
    const distance = Math.hypot(ax + ex * along - point[0], ay + ey * along - point[1]);
    if (best && best.distance <= distance) return;
    // "Long" edges are the sides of the spine; at least half the longest, so a square outline still tilts.
    const isLong = lengthOf(outline, [i, j]) >= longest / 2;
    const corners = !isLong || (along > 0.25 && along < 0.75) ? [i, j] : along <= 0.25 ? [i] : [j];
    best = { edge, corners, distance };
  });
  return best;
}

/**
 * Move a spine's edge by a drag of (dx, dy), only across the edge, never
 * along it. A finger that slips along the edge would otherwise lift one
 * corner above its neighbour, and the straightened spine would come out
 * sheared (Jakob's crooked Tale of Two Cities, 2026-11-11).
 * @param {number[][]} outline
 * @param {{ edge: number, corners: number[] }} grip from spineGrip
 * @param {number} dx
 * @param {number} dy
 * @returns {number[][]} a new outline
 */
export function moveSpineEdge(outline, grip, dx, dy) {
  const [i, j] = EDGES[grip.edge];
  const ex = outline[j][0] - outline[i][0];
  const ey = outline[j][1] - outline[i][1];
  const length = Math.hypot(ex, ey) || 1;
  const nx = -ey / length;
  const ny = ex / length;
  const across = dx * nx + dy * ny;
  return outline.map((point, k) => (grip.corners.includes(k) ? [point[0] + nx * across, point[1] + ny * across] : point));
}

/**
 * Where the magnifiers sit, chosen once when a drag starts so they never
 * jump: across from the point being placed, and at the bottom when the point
 * is in the top half, so a thumb working near the top never covers them.
 * @param {number[]} point
 * @param {number} width of the photo
 * @param {number} height of the photo
 * @returns {{ isRight: boolean, isBottom: boolean }}
 */
export function loupePlace(point, width, height) {
  return { isRight: point[0] < width / 2, isBottom: point[1] < height / 2 };
}
