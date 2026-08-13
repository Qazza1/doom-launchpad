import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateV2Manifest } from "../verify-manifest.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../../../config/v2-mainnet-deployment-manifest.json", import.meta.url), "utf8"),
);

test("committed V2 deployment manifest is valid and fail-closed", () => {
  assert.deepEqual(validateV2Manifest(manifest), []);
});

test("validator rejects broadcast or deployment authorization", () => {
  const unsafe = structuredClone(manifest);
  unsafe.safety.broadcast = true;
  unsafe.safety.deploymentAuthorized = true;
  unsafe.gates.explicitBroadcastApproval = true;
  assert.deepEqual(validateV2Manifest(unsafe), [
    "broadcast must remain false",
    "deployment must remain unauthorized",
    "broadcast approval must remain false",
  ]);
});

test("validator rejects output addresses before deployment", () => {
  const unsafe = structuredClone(manifest);
  unsafe.outputs.launchFactory = "0x1111111111111111111111111111111111111111";
  assert.deepEqual(validateV2Manifest(unsafe), ["deployment outputs must be empty"]);
});
