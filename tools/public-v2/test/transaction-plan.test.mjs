import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_ID, DEPLOYER, PUBLIC_FACTORY, STEPS, validateManifest, validatePlan } from "../transaction-plan.mjs";

const address = digit => `0x${digit.repeat(40)}`;

function callData(argument) {
  return `0x12345678${"0".repeat(24)}${argument.slice(2)}`;
}

function fixture() {
  const created = {
    DoomLaunchDeployerV2: address("1"),
    PositionLockerV2: address("2"),
    V3GraduationManagerV2: address("3"),
    [PUBLIC_FACTORY]: address("4"),
  };
  return {
    schemaVersion: 1,
    chainId: CHAIN_ID,
    deployer: DEPLOYER,
    startingNonce: 20,
    transactions: STEPS.map(step => {
      if (step.kind === "CREATE") {
        return {
          kind: "CREATE", contract: step.contract, from: DEPLOYER, to: null, value: "0x0",
          nonce: 20 + step.order, predictedAddress: created[step.contract], data: "0x6000",
        };
      }
      const target = step.order === 3 ? created.PositionLockerV2
        : step.order === 5 ? created.DoomLaunchDeployerV2 : created.V3GraduationManagerV2;
      const argument = step.order === 3 ? created.V3GraduationManagerV2 : created[PUBLIC_FACTORY];
      return {
        kind: "CALL", contract: step.contract, from: DEPLOYER, to: target, value: "0x0",
        nonce: 20 + step.order, predictedAddress: null, data: callData(argument),
      };
    }),
  };
}

test("public manifest remains fail closed", () => {
  const manifest = {
    network: { chainId: CHAIN_ID },
    roles: { deployer: DEPLOYER },
    safety: {
      broadcast: false, deploymentAuthorized: false, factoryResumeAuthorized: false,
      factoryMustRemainPaused: true, tokenLaunchAuthorized: false,
    },
    economics: { firstLaunchId: 2, finalLaunchId: 100 },
  };
  assert.deepEqual(validateManifest(manifest), []);
  manifest.safety.broadcast = true;
  assert.match(validateManifest(manifest).join("; "), /broadcast/);
});

test("exact public deployment plan accepts only seven sequential zero-value transactions", () => {
  const plan = fixture();
  assert.deepEqual(validatePlan(plan), []);
  plan.transactions[5].value = "0x1";
  assert.match(validatePlan(plan).join("; "), /zero value/);
});

test("binding calls must point at the public factory", () => {
  const plan = fixture();
  plan.transactions[6].data = callData(address("5"));
  assert.match(validatePlan(plan).join("; "), /wrong binding argument/);
});
