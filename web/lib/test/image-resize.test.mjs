import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_EDGE_PIXELS,
  MAX_STORED_BYTES,
  describeBytes,
  describeSaving,
  planResize,
  storageBudget,
} from "../image-resize.mjs";

const png = extra => ({ width: 1024, height: 1024, bytes: 1_800_000, type: "image/png", ...extra });

test("a large image is scaled to the long edge and re-compressed", () => {
  const plan = planResize(png());
  assert.equal(plan.action, "resize");
  assert.equal(plan.targetWidth, MAX_EDGE_PIXELS);
  assert.equal(plan.targetHeight, MAX_EDGE_PIXELS);
  assert.ok(plan.qualities.length > 0);
});

test("aspect ratio survives the scaling", () => {
  const wide = planResize(png({ width: 1600, height: 400 }));
  assert.equal(wide.targetWidth, 512);
  assert.equal(wide.targetHeight, 128);

  const tall = planResize(png({ width: 400, height: 1600 }));
  assert.equal(tall.targetWidth, 128);
  assert.equal(tall.targetHeight, 512);

  // Never rounds an edge away to zero.
  const sliver = planResize(png({ width: 4000, height: 3 }));
  assert.equal(sliver.targetHeight, 1);
});

test("an image that is already small is left alone", () => {
  const plan = planResize(png({ width: 256, height: 256, bytes: 40_000 }));
  assert.equal(plan.action, "keep");
  assert.deepEqual(plan.qualities, []);
});

test("a small but heavy image is still compressed", () => {
  // 256 pixels square but 900 KB: under the edge limit, far over the byte budget.
  const plan = planResize(png({ width: 256, height: 256, bytes: 900_000 }));
  assert.equal(plan.action, "resize");
  assert.equal(plan.targetWidth, 256, "no need to shrink the dimensions");
  assert.ok(plan.qualities.length > 0, "but it must be re-compressed");
});

/// Rasterising a vector image to hit a byte budget makes it worse at every size it is later shown
/// at, which is the opposite of the point.
test("SVG is stored as-is, or refused, never rasterised", () => {
  const small = planResize({ width: 512, height: 512, bytes: 12_000, type: "image/svg+xml" });
  assert.equal(small.action, "keep");
  assert.deepEqual(small.qualities, []);

  const huge = planResize({ width: 512, height: 512, bytes: 900_000, type: "image/svg+xml" });
  assert.equal(huge.action, "reject");
  assert.match(huge.reason, /not resized/);
});

test("sizes read the way a person would say them", () => {
  assert.equal(describeBytes(512), "512 B");
  assert.equal(describeBytes(200 * 1024), "200 KB");
  assert.equal(describeBytes(1_800_000), "1.7 MB");
});

/// Replacing somebody's upload with a smaller one should be visible, not silent.
test("the creator is told what happened to their file", () => {
  assert.equal(describeSaving({ before: 1_800_000, after: 180_000 }), "1.7 MB → 176 KB, 90% smaller.");
  // No claim of a saving when there wasn't one.
  assert.equal(describeSaving({ before: 40_000, after: 40_000 }), "Stored at 39 KB.");
  assert.equal(describeSaving({ before: 0, after: 1000 }), "Stored at 1000 B.");
});

/// The limits of the free Filebase plan, derived rather than written into a document that goes
/// stale. 500 pins is the ceiling on token count; bandwidth is what runs out first.
test("the storage budget is computed from the plan limits", () => {
  const budget = storageBudget({});
  assert.equal(budget.tokensBeforePinLimit, 500);
  assert.equal(budget.totalStorageBytes, MAX_STORED_BYTES * 500);
  // 100 MB of images for a full 500 tokens, against 5 GB of space.
  assert.ok(budget.totalStorageBytes < 110 * 1024 * 1024);
  // Roughly 26,000 image loads a month before the free bandwidth is gone.
  assert.ok(budget.imageViewsPerMonth > 20_000 && budget.imageViewsPerMonth < 30_000);

  // Without resizing, the same allowance is ten times smaller.
  const unresized = storageBudget({ perImageBytes: 2 * 1024 * 1024 });
  assert.ok(unresized.imageViewsPerMonth < 3000);
});
