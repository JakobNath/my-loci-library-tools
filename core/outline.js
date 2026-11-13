// The outline in the photo editor: where it starts, how a spine is placed by
// its two end dots and its sides, and where the magnifiers sit. Pure geometry
// on [x, y] points in the photo's own pixels; the editor (ui/photo-editor.js)
// draws it and handles the finger.

/**
 * The outline a cover starts with, inset from the photo's edges. Corners run
 * top left, top right, bottom right, bottom left.
 * @param {number} width
 * @param {number} height
 * @returns {number[][]}
 */
export function startingOutline(width, height) {
  return [[width * 0.1, height * 0.08], [width * 0.9, height * 0.08], [width * 0.9, height * 0.92], [width * 0.1, height * 0.92]];
}

/**
 * A spine as a person places it: a dot at the middle of its top, a dot at the
 * middle of its foot, and its width at each end. Two dots that move freely
 * follow a spine photographed at any slant (his wife could not turn the old
 * outline, 2026-11-12); two widths allow for a phone held a little tilted.
 * @typedef {{ top: number[], foot: number[], topWidth: number, footWidth: number }} Spine
 */

/**
 * The spine a photo starts with: a tall narrow band down the middle.
 * @param {number} width
 * @param {number} height
 * @returns {Spine}
 */
export function startingSpine(width, height) {
  const bandWidth = width * 0.18; // a spine photographed to fill the frame's height is about this narrow
  return { top: [width / 2, height * 0.05], foot: [width / 2, height * 0.95], topWidth: bandWidth, footWidth: bandWidth };
}

// A unit step across the spine, towards its right side when the top is above the foot.
function across({ top, foot }) {
  const dx = foot[0] - top[0];
  const dy = foot[1] - top[1];
  const length = Math.hypot(dx, dy) || 1;
  return [dy / length, -dx / length];
}

/**
 * The spine's four corners, top left, top right, bottom right, bottom left.
 * Each end is square to the line between the dots, so the straightened
 * spine is never sheared.
 * @param {Spine} spine
 * @returns {number[][]}
 */
export function spineOutline(spine) {
  const [rx, ry] = across(spine);
  const side = (point, width, sign) => [point[0] + sign * rx * width / 2, point[1] + sign * ry * width / 2];
  return [side(spine.top, spine.topWidth, -1), side(spine.top, spine.topWidth, 1), side(spine.foot, spine.footWidth, 1), side(spine.foot, spine.footWidth, -1)];
}

/**
 * What a press at `point` takes hold of: the top or foot dot, or a side.
 * The middle of a side changes the width at both ends; its outer quarter
 * changes only that end's width.
 * @param {Spine} spine
 * @param {number[]} point
 * @returns {{ part: 'top'|'foot'|'left'|'right', ends: string[], distance: number }}
 */
export function spineHandle(spine, point) {
  const [tl, tr, br, bl] = spineOutline(spine);
  const dot = (part, at) => ({ part, ends: [part], distance: Math.hypot(at[0] - point[0], at[1] - point[1]) });
  const side = (part, from, to) => {
    const ex = to[0] - from[0];
    const ey = to[1] - from[1];
    const along = Math.min(1, Math.max(0, ((point[0] - from[0]) * ex + (point[1] - from[1]) * ey) / (ex * ex + ey * ey || 1)));
    const ends = along < 0.25 ? ['top'] : along > 0.75 ? ['foot'] : ['top', 'foot'];
    return { part, ends, distance: Math.hypot(from[0] + ex * along - point[0], from[1] + ey * along - point[1]) };
  };
  // Dots first, so on a narrow spine a press between a dot and a corner takes the dot.
  const handles = [dot('top', spine.top), dot('foot', spine.foot), side('left', tl, bl), side('right', tr, br)];
  return handles.reduce((best, handle) => (handle.distance < best.distance ? handle : best));
}

/**
 * The spine after a drag of (dx, dy) on a handle. A dot follows the finger.
 * A side moves only across the spine, and the other side stays where it is,
 * so the end's middle shifts by half the change in width.
 * @param {Spine} spine
 * @param {{ part: string, ends: string[] }} handle from spineHandle
 * @param {number} dx
 * @param {number} dy
 * @returns {Spine} a new spine
 */
export function moveSpine(spine, handle, dx, dy) {
  if (handle.part === 'top') return { ...spine, top: [spine.top[0] + dx, spine.top[1] + dy] };
  if (handle.part === 'foot') return { ...spine, foot: [spine.foot[0] + dx, spine.foot[1] + dy] };
  const [rx, ry] = across(spine);
  const sign = handle.part === 'right' ? 1 : -1;
  const MIN_WIDTH = 2; // pixels: a side dragged past the other stops here instead of turning inside out
  // One end's middle and width after the side moves across by the drag.
  const widen = (point, width) => {
    const change = Math.max(MIN_WIDTH, width + sign * (dx * rx + dy * ry)) - width;
    return [[point[0] + sign * rx * change / 2, point[1] + sign * ry * change / 2], width + change];
  };
  const moved = { ...spine };
  if (handle.ends.includes('top')) [moved.top, moved.topWidth] = widen(spine.top, spine.topWidth);
  if (handle.ends.includes('foot')) [moved.foot, moved.footWidth] = widen(spine.foot, spine.footWidth);
  return moved;
}

/**
 * The point a handle places, for the magnifiers: the dot itself, or the part
 * of the side being moved.
 * @param {Spine} spine
 * @param {{ part: string, ends: string[] }} handle
 * @returns {number[]}
 */
export function spineHandlePoint(spine, handle) {
  if (handle.part === 'top') return spine.top;
  if (handle.part === 'foot') return spine.foot;
  const [tl, tr, br, bl] = spineOutline(spine);
  const [top, foot] = handle.part === 'left' ? [tl, bl] : [tr, br];
  if (handle.ends.length === 1) return handle.ends[0] === 'top' ? top : foot;
  return [(top[0] + foot[0]) / 2, (top[1] + foot[1]) / 2];
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
