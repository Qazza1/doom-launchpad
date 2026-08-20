import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_ID, DEPLOYER, FULLSCALE_FACTORY, STEPS, validateManifest, validatePlan } from "../transaction-plan.mjs";

const address = digit => `0x${digit.repeat(40)}`;

function plan() {
  const created = {
    DoomLaunchDeployerV2: address("1"),
    PositionLockerV2: address("2"),
    V3GraduationManagerV2: address("3"),
    [FULLSCALE_FACTORY]: address("4"),
  };
  const words = {
    3: created.V3GraduationManagerV2,
    5: created[FULLSCALE_FACTORY],
    6: created[FULLSCALE_FACTORY],
  };
  return {
    chainId: CHAIN_ID,
    deployer: DEPLOYER,
    startingNonce: 40,
    transactions: STEPS.map(step => ({
      order: step.order,
      kind: step.kind,
      contract: step.contract,
      from: DEPLOYER,
      to: step.kind === "CALL" ? ({ 3: created.PositionLockerV2, 5: created.DoomLaunchDeployerV2, 6: created.V3GraduationManagerV2 })[step.order] : null,
      value: "0x0",
      nonce: 40 + step.order,
      predictedAddress: step.kind === "CREATE" ? created[step.contract] : null,
      data: step.kind === "CREATE" ? "0x1234" : `0x12345678${words[step.order].slice(2).padStart(64, "0")}`,
    })),
  };
}

test("full-scale manifest is permissionless, uncapped, paused, and fail-closed", () => {
  assert.deepEqual(validateManifest({
    network: { chainId: CHAIN_ID },
    roles: { deployer: DEPLOYER },
    safety: {
      broadcast: false,
      deploymentAuthorized: false,
      factoryResumeAuthorized: false,
      factoryMustRemainPaused: true,
      tokenLaunchAuthorized: false,
    },
    economics: { firstLaunchId: 101, unboundedLaunches: true },
    creatorPolicy: { permissionlessEoaWallets: true, allowlist: false },
  }), []);
});

test("full-scale deployment accepts exactly seven sequential zero-value transactions", () => {
  assert.deepEqual(validatePlan(plan()), []);
  const wrong = plan();
  wrong.transactions[4].contract = "DoomPublicLaunchFactoryV2";
  assert.ok(validatePlan(wrong).length > 0);
});

test("full-scale plan rejects value, nonce, and binding drift", () => {
  for (const mutate of [
    value => { value.transactions[0].value = "0x1"; },
    value => { value.transactions[2].nonce += 1; },
    value => { value.transactions[6].data = `0x12345678${address("9").slice(2).padStart(64, "0")}`; },
  ]) {
    const value = plan();
    mutate(value);
    assert.ok(validatePlan(value).length > 0);
  }
});
