import assert from "node:assert/strict";
import test from "node:test";
import { compareReports, DEPENDENCIES, validateEndpointPair } from "../network-preflight.mjs";

test("RPC endpoints must be HTTPS and independently hosted", () => {
  assert.deepEqual(validateEndpointPair("https://primary.example/rpc", "https://fallback.example/rpc"), []);
  assert.ok(validateEndpointPair("http://primary.example", "https://primary.example/two").length >= 2);
  assert.ok(validateEndpointPair("bad", "also-bad").length === 2);
});

function report(overrides = {}) {
  return {
    chainId: 4663,
    blockNumber: 1000,
    pendingNonce: 7,
    code: Object.fromEntries(Object.keys(DEPENDENCIES).map(name => [name, { sha256Prefix: `${name}-hash` }])),
    ...overrides,
  };
}

test("matching provider reports pass", () => {
  assert.deepEqual(compareReports(report(), report({ blockNumber: 1002 })), []);
});

test("nonce, head, chain, and bytecode drift fail", () => {
  assert.ok(compareReports(report(), report({ pendingNonce: 8 })).includes("provider pending nonces disagree"));
  assert.ok(compareReports(report(), report({ blockNumber: 2000 })).some(error => error.includes("heads")));
  assert.ok(compareReports(report(), report({ chainId: 1 })).some(error => error.includes("chain IDs")));
  const changed = report();
  changed.code.wrappedNative.sha256Prefix = "different";
  assert.ok(compareReports(report(), changed).some(error => error.includes("wrappedNative")));
});
