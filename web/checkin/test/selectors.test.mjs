import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../../tools/lib/json-file.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");
const app = await readFile(resolve(directory, "../app.js"), "utf8");

const declared = Object.fromEntries(
  [...app.matchAll(/"([a-zA-Z]+\(\))":\s*"(0x[0-9a-f]{8})"/g)].map(match => [match[1], match[2]]),
);

test("every selector matches the compiled GmEscrow artifact", async () => {
  const artifact = await readJson(resolve(projectRoot, "out/GmEscrow.sol/GmEscrow.json"));
  assert.ok(Object.keys(declared).length >= 8, "expected the escrow selectors to be declared");
  for (const [signature, selector] of Object.entries(declared)) {
    const identifier = artifact.methodIdentifiers?.[signature];
    assert.ok(identifier, `GmEscrow no longer has ${signature}`);
    assert.equal(selector, `0x${identifier}`, `${signature} has drifted`);
  }
});

/// This is the only page here that can send. Its blast radius is defined by these three facts, so
/// each one is a test rather than a comment.
test("the only function it can call is recordGm", () => {
  assert.equal(declared["recordGm()"], "0x595100fc");
  // finalizeDefault sends someone else's allocation to the rewards vault. It must never appear.
  assert.ok(!app.includes("finalizeDefault"), "the page must not be able to finalise a default");
  assert.ok(!/dd74b358/i.test(app), "the finalizeDefault selector must not appear");

  const sends = [...app.matchAll(/method:\s*"(eth_send[A-Za-z]*)"/g)].map(match => match[1]);
  assert.deepEqual(sends, ["eth_sendTransaction"], "exactly one send, and no raw-transaction path");
  const dataFields = [...app.matchAll(/data:\s*([^,\n}]+)/g)].map(match => match[1].trim());
  assert.deepEqual(dataFields, ['SELECTORS["recordGm()"]'], "the calldata is not constructed anywhere");
});

test("the value it sends is hard-coded to zero", () => {
  assert.match(app, /value:\s*"0x0"/);
  // No arithmetic anywhere near the value: nothing can compute a non-zero amount.
  assert.ok(!/value:\s*[^"']/.test(app.replace(/value:\s*"0x0"/g, "")));
});

test("it refuses any chain but Robinhood, and any account but the creator", () => {
  assert.match(app, /CHAIN_HEX = "0x1237"/);
  assert.equal(parseInt("0x1237", 16), 4663);
  assert.match(app, /Switch to Robinhood Chain/);
  assert.match(app, /account !== String\(state\.creator\)\.toLowerCase\(\)/);
});

/// The window can close between loading the page and pressing the button.
test("state is re-read immediately before the wallet is prompted", () => {
  const handler = app.slice(app.indexOf('$("#send").addEventListener'));
  const refreshAt = handler.indexOf("await refresh()");
  const promptAt = handler.indexOf("eth_sendTransaction");
  assert.ok(refreshAt > -1 && refreshAt < promptAt, "refresh must happen before the prompt");
  assert.match(handler, /no longer open\. Nothing was sent/);
});

test("no key material is touched", () => {
  for (const forbidden of ["privateKey", "mnemonic", "eth_sign", "personal_sign", "seed"]) {
    assert.ok(!app.includes(forbidden), `app.js must not reference ${forbidden}`);
  }
});
