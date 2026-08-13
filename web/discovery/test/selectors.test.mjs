import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../../tools/lib/json-file.mjs";
import { DISCOVERY_SELECTORS, SELECTOR_SOURCES } from "../selectors.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");
const app = await readFile(resolve(directory, "../app.js"), "utf8");

test("every contract selector matches its compiled artifact", async () => {
  const artifacts = new Map();
  for (const [signature, contract] of Object.entries(SELECTOR_SOURCES)) {
    if (!artifacts.has(contract)) {
      artifacts.set(
        contract,
        await readJson(resolve(projectRoot, "out", `${contract}.sol`, `${contract}.json`)),
      );
    }
    const identifier = artifacts.get(contract).methodIdentifiers?.[signature];
    assert.ok(identifier, `${contract} no longer has ${signature}`);
    assert.equal(DISCOVERY_SELECTORS[signature], `0x${identifier}`, `${signature} has drifted`);
  }
  assert.equal(DISCOVERY_SELECTORS["name()"], "0x06fdde03");
  assert.equal(DISCOVERY_SELECTORS["symbol()"], "0x95d89b41");
});

test("the list cannot send a transaction", () => {
  for (const forbidden of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "privateKey", "window.ethereum"]) {
    assert.ok(!app.includes(forbidden), `app.js must not reference ${forbidden}`);
  }
  const methods = [...app.matchAll(/rpc\("([a-zA-Z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(methods)].sort(), ["eth_call", "eth_getBlockByNumber"]);
});

/// Token names and symbols come from contracts anyone can deploy, so they are attacker-controlled
/// text arriving on a public page.
test("token metadata never reaches the DOM as markup", () => {
  assert.ok(!/innerHTML\s*=\s*[^;]*item\./.test(app), "no launch field may be assigned via innerHTML");
  assert.ok(app.includes("link.textContent"), "the token name must be set with textContent");
  assert.match(app, /u0000-\\u001f\\u007f/, "control characters must be stripped from token metadata");
});

test("the list enumerates launches from the factory rather than trusting the indexer", () => {
  assert.match(app, /DISCOVERY_SELECTORS\["launchCount\(\)"\]/);
  // The indexer is consulted only for how far behind it is.
  const indexerUses = [...app.matchAll(/health\.([a-zA-Z_]+)/g)].map(match => match[1]);
  assert.deepEqual([...new Set(indexerUses)], ["cursor"]);
});

test("a failed load shows an unknown state, not an empty list", () => {
  assert.match(app, /state\.loadFailed = true/);
  assert.match(app, /loadFailed: true/);
});
