import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildWalletFeePolicy,
  compareMinedProviders,
  normalizePreviewReport,
  validatePreviewStep,
  validateReceiptLedger,
  validatePublicV2MainnetApproval,
  validateV2MainnetApproval,
} from "../mainnet-server.mjs";

const deployer = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
const addresses = {
  DoomLaunchDeployerV2: "0x1111111111111111111111111111111111111111",
  PositionLockerV2: "0x2222222222222222222222222222222222222222",
  V3GraduationManagerV2: "0x3333333333333333333333333333333333333333",
  DoomLaunchFactoryV2: "0x4444444444444444444444444444444444444444",
};
const txHash = `0x${"ab".repeat(32)}`;

const plan = () => ({
  startingNonce: 10,
  safety: {
    signerLoaded: false,
    signed: false,
    broadcast: false,
    factoryMustRemainPaused: true,
  },
  transactions: [
    { order: 0, kind: "CREATE", contract: "DoomLaunchDeployerV2", predictedAddress: addresses.DoomLaunchDeployerV2 },
    { order: 1, kind: "CREATE", contract: "PositionLockerV2", predictedAddress: addresses.PositionLockerV2 },
    { order: 2, kind: "CREATE", contract: "V3GraduationManagerV2", predictedAddress: addresses.V3GraduationManagerV2 },
    { order: 3, kind: "CALL", contract: "PositionLockerV2", predictedAddress: null },
    { order: 4, kind: "CREATE", contract: "DoomLaunchFactoryV2", predictedAddress: addresses.DoomLaunchFactoryV2 },
    { order: 5, kind: "CALL", contract: "DoomLaunchDeployerV2", predictedAddress: null },
    { order: 6, kind: "CALL", contract: "V3GraduationManagerV2", predictedAddress: null },
  ],
});

const approvalFor = (value, body) => ({
  status: "owner_authorized_exact_paused_v2_deployment",
  chainId: 4663,
  deployer,
  contractDigest: "ce824376a4639f5c8882d7723668576ebf5b1f9e21b596aba605463614164d24",
  planSha256: createHash("sha256").update(body).digest("hex"),
  startingNonce: 10,
  endingNonce: 16,
  transactionCount: 7,
  predictedAddresses: {
    curveDeployer: addresses.DoomLaunchDeployerV2,
    positionLocker: addresses.PositionLockerV2,
    graduationManager: addresses.V3GraduationManagerV2,
    launchFactory: addresses.DoomLaunchFactoryV2,
  },
  authorization: {
    sevenTransactionsOneAtATime: true,
    useExistingDeployerBalance: true,
    fundingTransfer: false,
    stopAndVerifyEveryReceipt: true,
    factoryMustRemainPaused: true,
    factoryResume: false,
    tokenLaunch: false,
    independentAuditDeferredUntilAfterInitialBetaLaunch: true,
  },
  validity: {
    pendingNonceMustRemain: 10,
    exactPlanDigestRequired: true,
    reauthorizationRequiredAfterNonceOrPayloadDrift: true,
  },
});

test("wallet fee policy locks the rehearsal limit and live fee ceiling", () => {
  assert.deepEqual(
    buildWalletFeePolicy(
      { localGasLimit: "6260838" },
      { feeCeilingWei: "89052000", maxPriorityFeeWei: "1000000" },
    ),
    {
      gasLimit: "6260838",
      maxFeePerGasWei: "89052000",
      maxPriorityFeePerGasWei: "1000000",
      maximumNetworkFeeWei: "557540145576000",
    },
  );
  assert.throws(
    () => buildWalletFeePolicy({ localGasLimit: "0" }, { feeCeilingWei: "1", maxPriorityFeeWei: "0" }),
    /gas limit/,
  );
  assert.equal(
    buildWalletFeePolicy(
      { gasLimit: "100" },
      { feeCeilingWei: "2", maxPriorityFeeWei: "1" },
    ).maximumNetworkFeeWei,
    "200",
  );
});

test("the owner authorization is exact, paused, zero-value-funding, and launch-free", () => {
  const value = plan();
  const body = `${JSON.stringify(value, null, 2)}\n`;
  assert.deepEqual(validateV2MainnetApproval(approvalFor(value, body), value, body), []);

  const wrongDigest = approvalFor(value, body);
  wrongDigest.planSha256 = "0".repeat(64);
  assert.ok(validateV2MainnetApproval(wrongDigest, value, body).some(error => error.includes("plan digest")));

  const funding = approvalFor(value, body);
  funding.authorization.fundingTransfer = true;
  assert.ok(validateV2MainnetApproval(funding, value, body).some(error => error.includes("funding transfer")));

  const resume = approvalFor(value, body);
  resume.authorization.factoryResume = true;
  assert.ok(validateV2MainnetApproval(resume, value, body).some(error => error.includes("resume")));

  const launch = approvalFor(value, body);
  launch.authorization.tokenLaunch = true;
  assert.ok(validateV2MainnetApproval(launch, value, body).some(error => error.includes("launch")));
});

test("the public owner authorization is exact, paused, and audit-deferral aware", () => {
  const value = plan();
  value.startingNonce = 19;
  value.transactions.forEach((transaction, index) => { transaction.nonce = 19 + index; });
  value.transactions[4].contract = "DoomPublicLaunchFactoryV2";
  value.transactions[4].predictedAddress = addresses.DoomLaunchFactoryV2;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const approval = approvalFor(value, body);
  approval.status = "owner_authorized_exact_paused_public_v2_deployment";
  approval.startingNonce = 19;
  approval.endingNonce = 25;
  approval.validity.pendingNonceMustRemain = 19;
  approval.authorization.independentAuditDeferredUntilAfterPublicLaunch = true;
  delete approval.authorization.independentAuditDeferredUntilAfterInitialBetaLaunch;
  assert.deepEqual(validatePublicV2MainnetApproval(approval, value, body), []);
  approval.authorization.independentAuditDeferredUntilAfterPublicLaunch = false;
  assert.ok(validatePublicV2MainnetApproval(approval, value, body).some(error => error.includes("audit-deferral")));
});

test("every server step requires all earlier receipts and no later receipt", () => {
  const value = plan();
  const ledger = { planSha256: "plan", receipts: [] };
  assert.deepEqual(validateReceiptLedger(value, ledger, 0), []);
  assert.ok(validateReceiptLedger(value, ledger, 1)[0].includes("exactly 1"));
  ledger.receipts.push({
    order: 0,
    planSha256: "plan",
    transactionHash: txHash,
    status: "verified_success",
  });
  assert.deepEqual(validateReceiptLedger(value, ledger, 1), []);
  assert.ok(validateReceiptLedger(value, ledger, 0)[0].includes("exactly 0"));
});

test("the localhost rehearsal must match address, nonce, digest, and gas limit", () => {
  const planned = { order: 0, nonce: 10, predictedAddress: addresses.DoomLaunchDeployerV2, dataSha256: "a".repeat(64) };
  const preview = { ...planned, localGasLimit: "6260838" };
  assert.deepEqual(validatePreviewStep(planned, preview), []);
  preview.nonce = 11;
  assert.ok(validatePreviewStep(planned, preview).some(error => error.includes("nonce")));
});

test("the public dual-provider rehearsal is accepted only when both gas reports agree", () => {
  const transaction = { order: 0, nonce: 19, dataSha256: "a".repeat(64), gasLimit: "100", gasUsed: "80" };
  const preview = { reports: [{ transactions: [transaction] }, { transactions: [structuredClone(transaction)] }] };
  assert.deepEqual(normalizePreviewReport(preview).transactions, [transaction]);
  preview.reports[1].transactions[0].gasLimit = "101";
  assert.throws(() => normalizePreviewReport(preview), /providers disagree/);
});

test("provider comparison catches transaction and receipt disagreement", () => {
  const transaction = { hash: txHash, from: deployer, to: null, input: "0x1234", nonce: "0xa", value: "0x0" };
  const receipt = {
    status: "0x1",
    from: deployer,
    to: null,
    contractAddress: addresses.DoomLaunchDeployerV2,
    blockHash: `0x${"cd".repeat(32)}`,
    transactionHash: txHash,
  };
  assert.deepEqual(compareMinedProviders(transaction, structuredClone(transaction), receipt, structuredClone(receipt)), []);
  const changed = structuredClone(transaction);
  changed.input = "0x5678";
  assert.ok(compareMinedProviders(transaction, changed, receipt, receipt).some(error => error.includes("input")));
});

test("the V2 browser client is module-scoped, seven-step aware, and has no privileged action", async () => {
  const html = await readFile(new URL("../mainnet.html", import.meta.url), "utf8");
  const javascript = await readFile(new URL("../mainnet.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../mainnet-server.mjs", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="\/mainnet\.js"><\/script>/);
  assert.match(javascript, /locked\.totalSteps/);
  assert.match(javascript, /maxFeePerGas:/);
  assert.match(javascript, /maxPriorityFeePerGas:/);
  assert.doesNotMatch(javascript, /resumeLaunches\s*\(/);
  assert.doesNotMatch(javascript, /\.launch\s*\(/);
  assert.doesNotMatch(server, /resumeLaunches\s*\(/);
  assert.doesNotMatch(server, /\.launch\s*\(/);
});
