import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXPECTED_ADDRESS,
  createChallenge,
  validateVerificationPayload,
} from "../rabby-verify-server.mjs";

const signature = `0x${"11".repeat(65)}`;

test("accepts only the exact deployer, challenge, and signature shape", () => {
  const message = createChallenge("fixed-test-challenge");
  assert.deepEqual(validateVerificationPayload({
    address: EXPECTED_ADDRESS.toLowerCase(),
    message,
    signature,
  }, message), []);
});

test("rejects a wrong address, message, or malformed signature", () => {
  const message = createChallenge("fixed-test-challenge");
  const errors = validateVerificationPayload({
    address: "0x0000000000000000000000000000000000000001",
    message: `${message} changed`,
    signature: "0x1234",
  }, message);
  assert.equal(errors.length, 3);
});

test("browser verifier contains no transaction or permission request", async () => {
  const source = await readFile(new URL("../rabby-verify.js", import.meta.url), "utf8");
  assert.equal(/eth_sendTransaction|eth_sendRawTransaction|wallet_requestPermissions/.test(source), false);
  assert.equal(source.includes("personal_sign"), true);
});
