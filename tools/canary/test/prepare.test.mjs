import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseArguments } from "../prepare.mjs";

test("arguments are validated before anything reads the chain", () => {
  assert.deepEqual(parseArguments(["--kind", "resume"]).errors, []);
  assert.deepEqual(parseArguments(["--kind", "launch", "--launch", "2"]).errors, []);

  assert.ok(parseArguments([]).errors.some(item => item.includes("--kind")));
  assert.ok(parseArguments(["--kind", "both"]).errors.some(item => item.includes("--kind")));
  // Three launches is the contract cap; a fourth must be impossible to even plan.
  assert.ok(parseArguments(["--kind", "launch", "--launch", "4"]).errors.some(item => item.includes("--launch")));
  assert.ok(parseArguments(["--kind", "launch", "--launch", "0"]).errors.some(item => item.includes("--launch")));
});

test("plan lifetime is bounded so a stale plan cannot be kept around", () => {
  assert.equal(parseArguments(["--kind", "resume"]).ttl, 900);
  assert.equal(parseArguments(["--kind", "resume", "--ttl", "300"]).ttl, 300);
  assert.ok(parseArguments(["--kind", "resume", "--ttl", "0"]).errors.some(item => item.includes("--ttl")));
  assert.ok(parseArguments(["--kind", "resume", "--ttl", "7200"]).errors.some(item => item.includes("--ttl")));
});

test("the preparation tool has no send path at all", async () => {
  const source = await readFile(new URL("../prepare.mjs", import.meta.url), "utf8");
  for (const forbidden of [
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "sendTransaction",
    "signTransaction",
    "privateKey",
    "PRIVATE_KEY",
    "Wallet(",
    "mnemonic",
  ]) {
    assert.equal(source.includes(forbidden), false, `prepare must not reference ${forbidden}`);
  }
  // It must say so to the operator too, not just be true in the source.
  assert.ok(source.includes("This tool cannot send"));
  assert.ok(source.includes("A resume approval never authorizes a launch"));
});
