import assert from "node:assert/strict";
import test from "node:test";
import { compareReports, validateEndpointPair } from "../network-preflight.mjs";

test("requires HTTPS endpoints on independent hosts", () => {
  assert.deepEqual(
    validateEndpointPair(
      "https://robinhood-mainnet.g.alchemy.com/v2/secret",
      "https://example.robinhood-mainnet.quiknode.pro/secret",
    ),
    [],
  );
  assert.ok(validateEndpointPair("http://one.example", "https://two.example").length);
  assert.ok(validateEndpointPair("https://one.example/a", "https://one.example/b").length);
});

test("provider comparison accepts matching state", () => {
  const report = {
    chainId: 4663,
    blockNumber: 18_000_000,
    pendingNonce: 4,
    code: {
      nftCollection: { sha256Prefix: "a" },
      wrappedNative: { sha256Prefix: "b" },
      uniswapV3Factory: { sha256Prefix: "c" },
      nonfungiblePositionManager: { sha256Prefix: "d" },
    },
  };
  assert.deepEqual(compareReports(report, structuredClone(report)), []);
});

test("provider comparison rejects chain, nonce, head, and bytecode disagreement", () => {
  const primary = {
    chainId: 4663,
    blockNumber: 18_000_000,
    pendingNonce: 4,
    code: {
      nftCollection: { sha256Prefix: "a" },
      wrappedNative: { sha256Prefix: "b" },
      uniswapV3Factory: { sha256Prefix: "c" },
      nonfungiblePositionManager: { sha256Prefix: "d" },
    },
  };
  const fallback = structuredClone(primary);
  fallback.chainId = 1;
  fallback.blockNumber += 501;
  fallback.pendingNonce = 5;
  fallback.code.wrappedNative.sha256Prefix = "changed";
  const errors = compareReports(primary, fallback);
  assert.equal(errors.length, 4);
});
