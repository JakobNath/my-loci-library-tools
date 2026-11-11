// The photo editor's outline: a spine's edges move only across themselves,
// their ends tilt, and the magnifiers keep clear of the finger.

import { startingOutline, spineGrip, moveSpineEdge, loupePlace } from '../outline.js';
import { equal, same } from './check.js';

// A spine photo 1,000 x 2,000 px; its starting band runs from x 410 to 590.
const spine = startingOutline(1000, 2000, 'spine');

export const tests = [
  {
    name: 'a press near the middle of a spine\'s left edge takes hold of both its corners',
    fn() {
      same(spineGrip(spine, [415, 1000]).corners, [3, 0]);
    },
  },
  {
    name: 'a press near the top of a spine\'s left edge takes hold of the top corner only',
    fn() {
      same(spineGrip(spine, [412, 200]).corners, [0]);
    },
  },
  {
    name: 'a press on a spine\'s short top bar always moves the whole bar',
    fn() {
      const grip = spineGrip(spine, [420, 100]);
      equal(grip.edge, 0, 'edge');
      same(grip.corners, [0, 1]);
    },
  },
  {
    name: 'a diagonal drag on a spine\'s left edge moves it only sideways, so the spine is not sheared',
    fn() {
      const moved = moveSpineEdge(spine, spineGrip(spine, [410, 1000]), -30, 80);
      same(moved[0], [380, 100]);
      same(moved[3], [380, 1900]);
      same(moved[1], spine[1], 'the right edge stays');
    },
  },
  {
    name: 'dragging the top end of a spine\'s edge tilts that edge and leaves its foot in place',
    fn() {
      const moved = moveSpineEdge(spine, spineGrip(spine, [410, 150]), -40, 0);
      same(moved[0], [370, 100]);
      same(moved[3], spine[3]);
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
