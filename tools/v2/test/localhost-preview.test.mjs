import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOYER, STEPS } from "../transaction-plan.mjs";
import { validateReceipts } from "../localhost-preview.mjs";

const address = index => `0x${String(index).padStart(40, "0")}`;

function fixture() {
  const transactions = STEPS.map((step, index) => ({
    ...step,
    from: DEPLOYER,
    to: step.kind === "CALL" ? address(index + 20) : null,
    predictedAddress: step.kind === "CREATE" ? address(index + 1) : null,
  }));
  const receipts = transactions.map(transaction => ({
    status: "0x1",
    from: DEPLOYER,
    to: transaction.to,
    contractAddress: transaction.predictedAddress,
  }));
  return [{ transactions }, receipts];
}

test("successful receipts matching all seven planned targets pass", () => {
  const [plan, receipts] = fixture();
  assert.deepEqual(validateReceipts(plan, receipts), []);
});

test("failed, wrong-sender, wrong-create, and wrong-call receipts fail", () => {
  for (const mutate of [
    receipts => { receipts[0].status = "0x0"; },
    receipts => { receipts[1].from = address(99); },
    receipts => { receipts[2].contractAddress = address(99); },
    receipts => { receipts[3].to = address(99); },
  ]) {
    const [plan, receipts] = fixture();
    mutate(receipts);
    assert.ok(validateReceipts(plan, receipts).length > 0);
  }
});
