// The photo editor's outline: a spine is placed by a dot at each end and its
// two sides, its ends stay square to the line between the dots, and the
// magnifiers keep clear of the finger.

import { startingSpine, spineOutline, spineHandle, moveSpine, spineHandlePoint, loupePlace } from '../outline.js';
import { equal, same, ok } from './check.js';

// A spine photo 1,000 x 2,000 px; its starting band runs from x 410 to 590, y 100 to 1900.
const spine = startingSpine(1000, 2000);
const rounded = points => points.map(point => point.map(Math.round));

export const tests = [
  {
    name: 'a spine starts as a band down the middle of the photo, its corners from top left round to bottom left',
    fn() {
      same(rounded(spineOutline(spine)), [[410, 100], [590, 100], [590, 1900], [410, 1900]]);
    },
  },
  {
    name: 'a press near the top or foot dot takes hold of that dot; a press on a side takes the side',
    fn() {
      equal(spineHandle(spine, [505, 110]).part, 'top');
      equal(spineHandle(spine, [500, 1890]).part, 'foot');
      const middle = spineHandle(spine, [412, 1000]);
      equal(middle.part, 'left');
      same(middle.ends, ['top', 'foot'], 'the middle of a side moves both ends');
      same(spineHandle(spine, [588, 300]).ends, ['top'], 'its outer quarter moves only the nearer end');
    },
  },
  {
    name: 'dragging the top dot sideways turns the spine, and its ends stay square to it, so it is not sheared',
    fn() {
      const turned = moveSpine(spine, spineHandle(spine, [500, 100]), 300, 0);
      same(turned.top, [800, 100]);
      same(turned.foot, spine.foot, 'the foot stays');
      const [tl, tr, br, bl] = spineOutline(turned);
      const axis = [turned.foot[0] - turned.top[0], turned.foot[1] - turned.top[1]];
      const topEnd = [tr[0] - tl[0], tr[1] - tl[1]];
      ok(Math.abs(axis[0] * topEnd[0] + axis[1] * topEnd[1]) < 1e-6, 'the top end is square to the line between the dots');
      equal(Math.round(Math.hypot(br[0] - bl[0], br[1] - bl[1])), 180, 'the width is kept');
    },
  },
  {
    name: 'dragging the right side outward widens the spine and leaves the left side where it was',
    fn() {
      const wider = moveSpine(spine, spineHandle(spine, [590, 1000]), 40, 25);
      same(rounded(spineOutline(wider)), [[410, 100], [630, 100], [630, 1900], [410, 1900]]);
    },
  },
  {
    name: 'dragging the top quarter of a side changes only the top width, as for a phone held a little tilted',
    fn() {
      const handle = spineHandle(spine, [410, 300]);
      const moved = moveSpine(spine, handle, -20, 0);
      equal(Math.round(moved.topWidth), 200);
      equal(moved.footWidth, 180);
      // The top's middle shifts by half the change, so the line between the dots turns very slightly.
      const [x, y] = spineHandlePoint(moved, handle);
      ok(Math.hypot(x - 390, y - 100) < 2, 'the magnifier shows the top left corner');
    },
  },
  {
    name: 'a side dragged past the other side stops at a sliver instead of turning inside out',
    fn() {
      const squeezed = moveSpine(spine, spineHandle(spine, [590, 1000]), -500, 0);
      equal(squeezed.topWidth, 2);
      equal(squeezed.footWidth, 2);
    },
  },
  {
    name: 'the magnifiers sit across from a corner being placed, at the bottom when it is near the top',
    fn() {
      same(loupePlace([100, 150], 1000, 1500), { isRight: true, isBottom: true });
      same(loupePlace([900, 1400], 1000, 1500), { isRight: false, isBottom: false });
    },
  },
];
