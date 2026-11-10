import { test } from "bun:test";
import assert from "node:assert/strict";

import { majorityColor } from "~/app/_components/ui";

const px = (...rgba: number[][]) => rgba.flat();

test("majorityColor averages the most common color bucket", () => {
  // Three near-blues outvote two reds; the transparent pixel is ignored.
  const d = px([0, 0, 250, 255], [0, 0, 254, 255], [0, 0, 252, 255], [255, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 0]);
  assert.equal(majorityColor(d), "#0000fc");
});

test("majorityColor gives null for a fully transparent image", () => {
  assert.equal(majorityColor(px([1, 2, 3, 0])), null);
});
