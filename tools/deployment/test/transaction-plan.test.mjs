import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAIN_ID,
  DEPLOYER,
  STEPS,
  validateDependencyWiring,
  validatePlan,
} from "../transaction-plan.mjs";

const rewards = "0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC";
const locker = "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0";
const manager = "0xbf36be8861ca4fe9920B10fc526E3fD039F88519";
const factory = "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE";
const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const padded = address => address.toLowerCase().slice(2).padStart(64, "0");
const encodedArguments = (...addresses) => `0x${addresses.map(padded).join("")}`;

const plan = () => {
  const created = { DoomRewards: rewards, PositionLocker: locker, V3LiquidityManager: manager, DoomLaunchFactory: factory };
  const constructorValues = {
    DoomRewards: [weth],
    PositionLocker: [rewards],
    V3LiquidityManager: [locker],
    DoomLaunchFactory: [[rewards, manager, locker]],
  };
  return {
    chainId: CHAIN_ID,
    startingNonce: 0,
    transactions: STEPS.map(step => {
      if (step.kind === "CREATE") {
        const encoded = encodedArguments(...constructorValues[step.contract].flat());
        return {
          order: step.order,
          kind: step.kind,
          contract: step.contract,
          irreversible: false,
          from: DEPLOYER,
          to: null,
          value: "0x0",
          nonce: step.order,
          predictedAddress: created[step.contract],
          constructorArgumentValues: constructorValues[step.contract],
          encodedConstructorArguments: encoded,
          data: `0x60806040${encoded.slice(2)}`,
        };
      }
      const isRegistrar = step.contract === "PositionLocker";
      return {
        order: step.order,
        kind: step.kind,
        contract: step.contract,
        irreversible: true,
        from: DEPLOYER,
        to: isRegistrar ? locker : manager,
        value: "0x0",
        nonce: step.order,
        predictedAddress: null,
        data: `0x${isRegistrar ? "1a2b3c4d" : "5e6f7a8b"}${padded(isRegistrar ? manager : factory)}`,
      };
    }),
  };
};

test("the reference six-transaction plan is accepted", () => {
  assert.deepEqual(validatePlan(plan()), []);
  assert.deepEqual(validateDependencyWiring(plan()), []);
});

test("nonces must be sequential and the sender must be the approved deployer", () => {
  const skipped = plan();
  skipped.transactions[2].nonce = 9;
  assert.ok(validatePlan(skipped).some(error => error.includes("non-sequential nonce")));

  const impostor = plan();
  impostor.transactions[0].from = "0x0000000000000000000000000000000000000009";
  assert.ok(validatePlan(impostor).some(error => error.includes("wrong sender")));

  const shortened = plan();
  shortened.transactions.pop();
  assert.ok(validatePlan(shortened).some(error => error.includes("exactly six transactions")));

  const wrongChain = plan();
  wrongChain.chainId = 1;
  assert.ok(validatePlan(wrongChain).some(error => error.includes("chain 4663")));
});

test("no transaction in the plan may carry value", () => {
  const funded = plan();
  funded.transactions[4].value = "0x2386f26fc10000";
  assert.ok(validatePlan(funded).some(error => error.includes("must not transfer value")));
});

test("creation code must end with the encoded constructor arguments", () => {
  const stale = plan();
  stale.transactions[1].data = "0x60806040deadbeef";
  assert.ok(
    validatePlan(stale).some(error => error.includes("does not end with its encoded constructor")),
  );

  const empty = plan();
  empty.transactions[0].data = "0x";
  assert.ok(validatePlan(empty).some(error => error.includes("empty creation code")));
});

test("an irreversible binding must target and pass the predicted addresses", () => {
  const wrongTarget = plan();
  wrongTarget.transactions[3].to = manager;
  assert.ok(
    validatePlan(wrongTarget).some(error =>
      error.includes("bindRegistrar must target the predicted PositionLocker")
    ),
  );

  const wrongArgument = plan();
  wrongArgument.transactions[5].data = `0x5e6f7a8b${padded(locker)}`;
  assert.ok(
    validatePlan(wrongArgument).some(error =>
      error.includes("bindFactory must pass the predicted DoomLaunchFactory")
    ),
  );

  const overlongCalldata = plan();
  overlongCalldata.transactions[3].data = `0x1a2b3c4d${padded(manager)}${padded(locker)}`;
  assert.ok(
    validatePlan(overlongCalldata).some(error =>
      error.includes("not a single address argument")
    ),
  );

  const creates = plan();
  creates.transactions[3].to = null;
  assert.ok(validatePlan(creates).some(error => error.includes("must call a concrete address")));
});

test("a contract wired to a stale dependency address is rejected", () => {
  const staleLocker = plan();
  staleLocker.transactions[1].constructorArgumentValues = [
    "0x1111111111111111111111111111111111111111",
  ];
  assert.deepEqual(validateDependencyWiring(staleLocker), [
    "PositionLocker was not given the predicted DoomRewards address",
  ]);

  const staleFactory = plan();
  staleFactory.transactions[4].constructorArgumentValues = [[rewards, manager]];
  assert.deepEqual(validateDependencyWiring(staleFactory), [
    "DoomLaunchFactory was not given the predicted PositionLocker address",
  ]);

  const staleManager = plan();
  staleManager.transactions[2].constructorArgumentValues = [factory];
  assert.deepEqual(validateDependencyWiring(staleManager), [
    "V3LiquidityManager was not given the predicted PositionLocker address",
  ]);
});

test("addresses are compared without case sensitivity", () => {
  const lowercased = plan();
  lowercased.transactions[1].constructorArgumentValues = [rewards.toUpperCase().replace("0X", "0x")];
  assert.deepEqual(validateDependencyWiring(lowercased), []);
});
