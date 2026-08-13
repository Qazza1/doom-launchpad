import assert from "node:assert/strict";
import test from "node:test";
import { CHAIN_ID, DEPLOYER, STEPS, validateDependencyWiring, validatePlan } from "../transaction-plan.mjs";

const addresses = {
  DoomLaunchDeployerV2: "0x1111111111111111111111111111111111111111",
  PositionLockerV2: "0x2222222222222222222222222222222222222222",
  V3GraduationManagerV2: "0x3333333333333333333333333333333333333333",
  DoomLaunchFactoryV2: "0x4444444444444444444444444444444444444444",
};
const padded = value => value.slice(2).padStart(64, "0");

function plan() {
  const constructorArguments = {
    DoomLaunchDeployerV2: [DEPLOYER],
    PositionLockerV2: ["0x5555555555555555555555555555555555555555"],
    V3GraduationManagerV2: [addresses.PositionLockerV2],
    DoomLaunchFactoryV2: [[addresses.V3GraduationManagerV2, addresses.DoomLaunchDeployerV2]],
  };
  return {
    chainId: CHAIN_ID,
    startingNonce: 9,
    transactions: STEPS.map(step => {
      if (step.kind === "CREATE") {
        const encodedConstructorArguments = `0x${constructorArguments[step.contract].flat().map(padded).join("")}`;
        return {
          ...step,
          irreversible: false,
          from: DEPLOYER,
          to: null,
          value: "0x0",
          nonce: 9 + step.order,
          predictedAddress: addresses[step.contract],
          constructorArgumentValues: constructorArguments[step.contract],
          encodedConstructorArguments,
          data: `0x60806040${encodedConstructorArguments.slice(2)}`,
        };
      }
      const target = step.order === 3 ? addresses.PositionLockerV2
        : step.order === 5 ? addresses.DoomLaunchDeployerV2 : addresses.V3GraduationManagerV2;
      const argument = step.order === 3 ? addresses.V3GraduationManagerV2 : addresses.DoomLaunchFactoryV2;
      return {
        ...step,
        from: DEPLOYER,
        to: target,
        value: "0x0",
        nonce: 9 + step.order,
        predictedAddress: null,
        data: `0x12345678${padded(argument)}`,
      };
    }),
  };
}

test("the reference seven-transaction V2 plan is accepted", () => {
  assert.deepEqual(validatePlan(plan()), []);
  assert.deepEqual(validateDependencyWiring(plan()), []);
});

test("wrong chain, value, nonce, or sender is rejected", () => {
  for (const mutate of [
    value => { value.chainId = 1; },
    value => { value.transactions[0].value = "0x1"; },
    value => { value.transactions[2].nonce += 1; },
    value => { value.transactions[6].from = addresses.PositionLockerV2; },
  ]) {
    const value = plan();
    mutate(value);
    assert.ok(validatePlan(value).length > 0);
  }
});

test("each irreversible binding target and argument is checked", () => {
  for (const index of [3, 5, 6]) {
    const wrongTarget = plan();
    wrongTarget.transactions[index].to = addresses.DoomLaunchFactoryV2;
    assert.ok(validatePlan(wrongTarget).length > 0);
    const wrongArgument = plan();
    wrongArgument.transactions[index].data = `0x12345678${padded(addresses.PositionLockerV2)}`;
    assert.ok(validatePlan(wrongArgument).length > 0);
  }
});

test("predicted dependencies must be threaded into manager and factory", () => {
  const staleManager = plan();
  staleManager.transactions[2].constructorArgumentValues = [addresses.DoomLaunchFactoryV2];
  assert.ok(validateDependencyWiring(staleManager)[0].includes("PositionLockerV2"));

  const staleFactory = plan();
  staleFactory.transactions[4].constructorArgumentValues = [[addresses.V3GraduationManagerV2]];
  assert.ok(validateDependencyWiring(staleFactory)[0].includes("DoomLaunchDeployerV2"));
});
