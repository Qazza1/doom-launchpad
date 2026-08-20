import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDeploymentRecord } from "../deployment-session.mjs";

test("one-page session preserves per-step receipt and wallet boundaries", async () => {
  const [session, client, server] = await Promise.all([
    readFile(new URL("../deployment-session.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../v2/mainnet.js", import.meta.url), "utf8"),
    readFile(new URL("../../v2/mainnet-server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(session, /while \(completed < plan\.transactions\.length\)/);
  assert.match(session, /observed !== completed \+ 1/);
  assert.match(session, /DOOM_DEPLOYMENT_SESSION: "1"/);
  assert.match(client, /await waitForNextSessionStep\(locked\.step\)/);
  assert.match(client, /eth_sendTransaction/);
  assert.match(server, /validateStepSubmission/);
  assert.match(server, /verifyCreatedRuntime/);
  assert.match(server, /verifyBinding/);
  assert.doesNotMatch(session, /privateKey|seed phrase|eth_sendRawTransaction/i);
});

test("completed session produces one canonical paused deployment record", () => {
  const transactions = [
    ["DoomLaunchDeployerV2", "0x1111111111111111111111111111111111111111"],
    ["PositionLockerV2", "0x2222222222222222222222222222222222222222"],
    ["V3GraduationManagerV2", "0x3333333333333333333333333333333333333333"],
    [null, null],
    ["DoomFullScaleLaunchFactoryV3", "0x4444444444444444444444444444444444444444"],
    [null, null],
    [null, null],
  ].map(([contract, predictedAddress], order) => ({
    order,
    kind: contract ? "CREATE" : "CALL",
    contract,
    predictedAddress,
  }));
  const receipts = transactions.map((transaction, order) => ({
    order,
    status: "verified_success",
    providersAgreed: true,
    blockNumber: 100 + order,
  }));
  const plan = { chainId: 4663, transactions };
  const record = buildDeploymentRecord(
    `${JSON.stringify(plan)}\n`,
    plan,
    { receipts },
    { source: { candidateCommit: "abc", contractDigest: "def" } },
  );
  assert.equal(record.status, "fullscale_v3_mainnet_deployment_verified_paused");
  assert.equal(record.factoryDeploymentBlock, "104");
  assert.equal(record.addresses.launchFactory, transactions[4].predictedAddress);
  assert.equal(record.verification.unboundedLaunches, true);
  assert.equal(record.safety.factoryResumeAuthorized, false);
});
