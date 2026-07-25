import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  WORKSHEET_VALID_SECONDS,
  assertPreviewIsCurrent,
  buildGasPlan,
  buildNoncePlan,
  chooseFeeCeiling,
  combineFeeCeilings,
  validateFundingProposal,
} from "../funding-refresh.mjs";

const canonical = JSON.parse(
  await readFile(new URL("../../../config/stage4-deployment-manifest.json", import.meta.url), "utf8"),
);
const head = "0123456789abcdef0123456789abcdef01234567";
const preview = () => ({
  status: "localhost_preview_passed",
  sourceCommit: head,
  deployer: { observedPendingNonce: 4 },
  transactions: [{ localGasLimit: "1000" }, { localGasLimit: "2000" }],
});
const proposal = () => ({
  ...structuredClone(canonical),
  noncePlan: buildNoncePlan(4, 18988889),
  gasPlan: buildGasPlan({
    simulatedAtBlock: 18988889,
    totalPlannedGas: 11558877n,
    feeCeilingWei: "164368000",
  }),
});

test("the fee ceiling leaves room for the base fee to double", () => {
  assert.equal(
    chooseFeeCeiling({ gasPriceWei: "82332000", baseFeeWei: "82184000", maxPriorityFeeWei: "0" }),
    "164368000",
  );
  // A spot gas price above the 1559 formula still wins.
  assert.equal(
    chooseFeeCeiling({ gasPriceWei: "900", baseFeeWei: "100", maxPriorityFeeWei: "50" }),
    "900",
  );
  assert.equal(
    chooseFeeCeiling({ gasPriceWei: "100", baseFeeWei: "100", maxPriorityFeeWei: "50" }),
    "250",
  );
  assert.equal(chooseFeeCeiling({}), "0");
});

test("the higher provider ceiling wins", () => {
  // Funding from the cheaper provider is what strands a half-deployed system.
  assert.equal(combineFeeCeilings("100", "250"), "250");
  assert.equal(combineFeeCeilings("250", "100"), "250");
  assert.equal(combineFeeCeilings("250", "250"), "250");
});

test("the nonce plan is sequential from the observed pending nonce", () => {
  const plan = buildNoncePlan(4, 18988889);
  assert.equal(plan.startingNonce, 4);
  assert.equal(plan.observedAtBlock, 18988889);
  assert.deepEqual(
    [plan.doomRewards, plan.positionLocker, plan.v3LiquidityManager],
    [4, 5, 6],
  );
  assert.deepEqual([plan.bindRegistrar, plan.doomLaunchFactory, plan.bindFactory], [7, 8, 9]);
  assert.throws(() => buildNoncePlan(-1, 1), /non-negative integer/);
  assert.throws(() => buildNoncePlan(1.5, 1), /non-negative integer/);
});

test("the gas plan applies the frozen 25 percent buffer", () => {
  const plan = buildGasPlan({
    simulatedAtBlock: 18988889,
    totalPlannedGas: 11558877n,
    feeCeilingWei: "164368000",
  });
  assert.equal(plan.maxCostBeforeBufferWei, "1899909494736000");
  assert.equal(plan.requiredDeployerBalanceWei, "2374886868420000");
  assert.equal(plan.fundingBufferBps, 2500);
});

test("a stale or foreign localhost preview cannot fund a deployment", () => {
  assert.deepEqual(assertPreviewIsCurrent(preview(), head, 4), []);
  assert.deepEqual(assertPreviewIsCurrent(null, head, 4), [
    "no localhost preview report was found; run the preview first",
  ]);

  const otherCommit = assertPreviewIsCurrent(preview(), "f".repeat(40), 4);
  assert.ok(otherCommit.some(error => error.includes("re-run the preview from the commit")));

  const movedNonce = assertPreviewIsCurrent(preview(), head, 9);
  assert.ok(movedNonce.some(error => error.includes("every predicted address changed")));

  const notPassing = preview();
  notPassing.status = "localhost_preview_failed";
  assert.ok(
    assertPreviewIsCurrent(notPassing, head, 4).some(error => error.includes("passing run")),
  );
});

test("a valid funding proposal carries fresh nonce and gas values and nothing else", () => {
  assert.deepEqual(validateFundingProposal(proposal()), []);
  assert.ok(WORKSHEET_VALID_SECONDS <= 3600, "a worksheet must expire well inside an hour");
});

test("a funding proposal can never carry an approval, verification, or review claim", () => {
  const approved = proposal();
  approved.safety.mainnetDeploymentApproved = true;
  assert.ok(
    validateFundingProposal(approved).some(error => error.includes("must not record deployment approval")),
  );

  const ownerSigned = proposal();
  ownerSigned.safety.finalOwnerApprovalRecorded = true;
  assert.ok(
    validateFundingProposal(ownerSigned).some(error => error.includes("must not record owner approval")),
  );

  const broadcasting = proposal();
  broadcasting.safety.broadcast = true;
  assert.ok(validateFundingProposal(broadcasting).some(error => error.includes("broadcast must remain false")));

  const verified = proposal();
  verified.verification.rolesVerified = true;
  assert.ok(
    validateFundingProposal(verified).some(error => error.includes("must not record any verification")),
  );

  const reviewed = proposal();
  reviewed.independentReview.reviewer = "someone";
  assert.ok(
    validateFundingProposal(reviewed).some(error => error.includes("cannot record an independent review")),
  );

  const deployed = proposal();
  deployed.transactions.doomRewards.address = "0x1111111111111111111111111111111111111111";
  assert.ok(
    validateFundingProposal(deployed).some(error => error.includes("must not record deployed transactions")),
  );
});

test("funding arithmetic that does not reconcile is rejected", () => {
  const underfunded = proposal();
  underfunded.gasPlan.requiredDeployerBalanceWei = "1";
  assert.ok(
    validateFundingProposal(underfunded).some(error =>
      error.includes("does not match the buffered arithmetic")
    ),
  );

  const wrongCost = proposal();
  wrongCost.gasPlan.maxCostBeforeBufferWei = "1";
  assert.ok(
    validateFundingProposal(wrongCost).some(error =>
      error.includes("does not equal gas multiplied by the fee ceiling")
    ),
  );

  const cheapBuffer = proposal();
  cheapBuffer.gasPlan.fundingBufferBps = 0;
  assert.ok(validateFundingProposal(cheapBuffer).some(error => error.includes("buffer must stay 25%")));

  const noBlock = proposal();
  noBlock.gasPlan.simulatedAtBlock = null;
  assert.ok(validateFundingProposal(noBlock).some(error => error.includes("simulated at")));
});

test("a nonce plan that skips or reorders a step is rejected", () => {
  const skipped = proposal();
  skipped.noncePlan.doomLaunchFactory = 99;
  assert.ok(validateFundingProposal(skipped).some(error => error.includes("doomLaunchFactory is not sequential")));

  const swapped = proposal();
  swapped.noncePlan.bindRegistrar = swapped.noncePlan.v3LiquidityManager;
  assert.ok(validateFundingProposal(swapped).some(error => error.includes("bindRegistrar is not sequential")));

  const unread = proposal();
  unread.noncePlan.observedAtBlock = null;
  assert.ok(validateFundingProposal(unread).some(error => error.includes("block it was read at")));
});

test("malformed predicted addresses are rejected", () => {
  const errors = validateFundingProposal(proposal(), {
    predictedAddresses: { DoomRewards: "0xnope" },
  });
  assert.ok(errors.some(error => error.includes("predicted address for DoomRewards is malformed")));
});
