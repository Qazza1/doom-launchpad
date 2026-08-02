import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../../tools/lib/json-file.mjs";
import { SELECTORS } from "../selectors.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");

/// A wrong selector does not throw. It reads a different function and puts a confident, wrong
/// number in front of a creator about to spend real money.
test("every inlined selector matches the compiled factory artifact", async () => {
  const artifact = await readJson(
    resolve(projectRoot, "out/DoomLaunchFactory.sol/DoomLaunchFactory.json"),
  );
  for (const [signature, selector] of Object.entries(SELECTORS)) {
    const identifier = artifact.methodIdentifiers?.[signature];
    assert.ok(identifier, `the factory no longer has ${signature}`);
    assert.equal(selector, `0x${identifier}`, `${signature} selector has drifted`);
  }
});

/// The prototype must not acquire a way to send a transaction by accident.
test("the launch flow has no send path and loads no wallet key", async () => {
  const app = await readFile(resolve(directory, "../app.js"), "utf8");
  for (const forbidden of [
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "eth_sign",
    "personal_sign",
    "privateKey",
    "mnemonic",
  ]) {
    assert.ok(!app.includes(forbidden), `app.js must not reference ${forbidden}`);
  }
  // Reads only. If this list ever grows, it should be a deliberate change with a reason.
  const methods = [...app.matchAll(/rpc\("([a-zA-Z_]+)"/g)].map(match => match[1]);
  assert.deepEqual([...new Set(methods)].sort(), ["eth_call", "eth_chainId"]);
});

test("the launch button is disabled and says why", async () => {
  const [app, html] = await Promise.all([
    readFile(resolve(directory, "../app.js"), "utf8"),
    readFile(resolve(directory, "../index.html"), "utf8"),
  ]);
  assert.match(html, /id="launch"[^>]*disabled/);
  assert.match(app, /button\.disabled = true/);
  assert.match(app, /Disabled on purpose/);
});
