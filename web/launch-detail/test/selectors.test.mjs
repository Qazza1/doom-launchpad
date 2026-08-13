import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../../tools/lib/json-file.mjs";
import { DETAIL_SELECTORS, SELECTOR_SOURCES } from "../selectors.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");

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
    assert.equal(DETAIL_SELECTORS[signature], `0x${identifier}`, `${signature} has drifted`);
  }
});

test("the standard token selectors are the standard values", () => {
  assert.equal(DETAIL_SELECTORS["balanceOf(address)"], "0x70a08231");
  assert.equal(DETAIL_SELECTORS["totalSupply()"], "0x18160ddd");
  assert.equal(DETAIL_SELECTORS["ownerOf(uint256)"], "0x6352211e");
});

test("every selector the page uses is declared, and every declared one is used", async () => {
  const app = await readFile(resolve(directory, "../app.js"), "utf8");
  // Some lookups are dynamic (`escrowUint("status()")`), so usage is detected by the signature
  // string appearing at all rather than by the indexing expression.
  const used = new Set(Object.keys(DETAIL_SELECTORS).filter(signature => app.includes(`"${signature}"`)));
  for (const signature of [...app.matchAll(/DETAIL_SELECTORS\["([^"]+)"\]/g)].map(match => match[1])) {
    assert.ok(DETAIL_SELECTORS[signature], `${signature} is used but not declared`);
  }
  // committedAmount is declared but read from the launch record instead; keeping an unused entry
  // invites the next person to trust a selector nothing verifies against real output.
  const declaredUnused = Object.keys(DETAIL_SELECTORS).filter(signature => !used.has(signature));
  assert.deepEqual(declaredUnused, ["committedAmount()"]);
});

test("the detail page cannot send a transaction", async () => {
  const app = await readFile(resolve(directory, "../app.js"), "utf8");
  for (const forbidden of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "privateKey", "window.ethereum"]) {
    assert.ok(!app.includes(forbidden), `app.js must not reference ${forbidden}`);
  }
  const methods = [...app.matchAll(/rpc\("([a-zA-Z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(methods)].sort(), ["eth_call", "eth_getBlockByNumber"]);
});

/// The page must survive the indexer being down, because on 2026-08-02 it was.
test("the indexer is optional and its failure cannot break the page", async () => {
  const app = await readFile(resolve(directory, "../app.js"), "utf8");
  const block = app.slice(app.indexOf("async function readIndexerLag"), app.indexOf("async function load"));
  assert.match(block, /catch \{\s*return null;/, "an indexer failure must return null, not throw");
  assert.match(block, /AbortSignal\.timeout/, "the indexer call must be bounded by a timeout");
  // Every figure on the page comes from the chain reads, never from the indexer response.
  assert.ok(!/health\.(launches|allocation|supply)/.test(app));
});
