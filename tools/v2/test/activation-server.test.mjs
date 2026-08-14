import assert from "node:assert/strict";
import test from "node:test";
import { validateAuthorization } from "../activation-server.mjs";
import { CUTOVER_OPERATIONS } from "../activation-preflight.mjs";

function values() {
  const transaction = {
    from: "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F",
    to: "0x142760D2C865537c063492933FB71ddefA2372C6",
    value: "0x0",
    data: "0xd255d203",
    nonce: 17,
    gasLimit: "50000",
  };
  return {
    authorization: {
      status: "owner_authorized_exact_v2_activation",
      chainId: 4663,
      transaction: { ...transaction, function: "resumeLaunches()" },
      scope: {
        transactionCount: 1,
        factoryResume: true,
        tokenLaunch: false,
        ethTransfer: false,
        contractDeployment: false,
        tokenApproval: false,
        otherContractCall: false,
      },
    },
    preflight: { transaction, safety: { signed: false, broadcast: false } },
  };
}

test("exact activation authorization matches the fresh preflight", () => {
  const { authorization, preflight } = values();
  assert.deepEqual(validateAuthorization(authorization, preflight), []);
});

test("nonce, value, calldata, or expanded scope invalidates authorization", () => {
  for (const mutate of [
    value => { value.authorization.transaction.nonce = 18; },
    value => { value.authorization.transaction.value = "0x1"; },
    value => { value.authorization.transaction.data = "0x"; },
    value => { value.authorization.scope.tokenLaunch = true; },
  ]) {
    const value = values();
    mutate(value);
    assert.ok(validateAuthorization(value.authorization, value.preflight).length > 0);
  }
});

test("legacy pause authorization cannot be expanded into resume or launch", () => {
  const transaction = {
    from: "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F",
    to: "0x142760D2C865537c063492933FB71ddefA2372C6",
    value: "0x0",
    data: "0xe79b502e",
    nonce: 26,
    gasLimit: "58000",
  };
  const authorization = {
    status: "owner_authorized_exact_legacy_pause",
    chainId: 4663,
    transaction: { ...transaction, function: "pauseLaunches()" },
    scope: {
      transactionCount: 1,
      legacyFactoryPause: true,
      factoryResume: false,
      tokenLaunch: false,
      ethTransfer: false,
      contractDeployment: false,
      tokenApproval: false,
      otherContractCall: false,
    },
  };
  const preflight = { transaction, safety: { signed: false, broadcast: false } };
  assert.deepEqual(validateAuthorization(authorization, preflight, CUTOVER_OPERATIONS.legacyPause), []);
  authorization.scope.factoryResume = true;
  assert.ok(validateAuthorization(authorization, preflight, CUTOVER_OPERATIONS.legacyPause).length > 0);
});

test("a narrowly bounded wallet gas adjustment is accepted but an open-ended one is refused", () => {
  const { authorization, preflight } = values();
  authorization.transaction.maximumGasLimit = "75000";
  assert.deepEqual(validateAuthorization(authorization, preflight), []);
  authorization.transaction.maximumGasLimit = "100001";
  assert.ok(validateAuthorization(authorization, preflight).some(error => error.includes("safety bound")));
});
