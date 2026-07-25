import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAIN_ID,
  DEPLOYER,
  calculateFunding,
  validateBroadcastRun,
} from "../localhost-preview.mjs";

const predicted = {
  "0": "0x1111111111111111111111111111111111111111",
  "1": "0x2222222222222222222222222222222222222222",
  "2": "0x3333333333333333333333333333333333333333",
  "4": "0x4444444444444444444444444444444444444444",
};
const sequence = [
  ["CREATE", "DoomRewards", null, predicted["0"]],
  ["CREATE", "PositionLocker", null, predicted["1"]],
  ["CREATE", "V3LiquidityManager", null, predicted["2"]],
  ["CALL", "PositionLocker", "bindRegistrar(address)", null],
  ["CREATE", "DoomLaunchFactory", null, predicted["4"]],
  ["CALL", "V3LiquidityManager", "bindFactory(address)", null],
];
const validRun = {
  chain: CHAIN_ID,
  transactions: sequence.map(([transactionType, contractName, fn, contractAddress], nonce) => ({
    transactionType,
    contractName,
    function: fn,
    contractAddress,
    transaction: {
      nonce: `0x${nonce.toString(16)}`,
      from: DEPLOYER,
    },
  })),
  receipts: sequence.map(([, , , contractAddress]) => ({
    status: "0x1",
    from: DEPLOYER,
    contractAddress,
  })),
};

test("accepts the exact six-transaction localhost sequence", () => {
  assert.deepEqual(validateBroadcastRun(validRun, 0, predicted), []);
});

test("rejects sender, nonce, receipt, and predicted-address drift", () => {
  const changed = structuredClone(validRun);
  changed.transactions[0].transaction.from = "0x0000000000000000000000000000000000000001";
  changed.transactions[1].transaction.nonce = "0x9";
  changed.receipts[2].status = "0x0";
  changed.transactions[4].contractAddress = "0x5555555555555555555555555555555555555555";
  const errors = validateBroadcastRun(changed, 0, predicted);
  assert.ok(errors.some(error => error.includes("wrong sender")));
  assert.ok(errors.some(error => error.includes("wrong nonce")));
  assert.ok(errors.some(error => error.includes("did not succeed")));
  assert.ok(errors.some(error => error.includes("CREATE prediction")));
});

test("adds an exact 25 percent buffer to planned gas at the fee ceiling", () => {
  assert.deepEqual(calculateFunding(1_000n, 20n), {
    baseCostWei: 20_000n,
    requiredBalanceWei: 25_000n,
  });
});
