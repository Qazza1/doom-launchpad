import assert from "node:assert/strict";
import test from "node:test";
import {
  localPathRemappingCount,
  sanitizeLocalRemappings,
  validateArtifactAgainstPlan,
  validateCompilerInput,
  validateDeploymentEvidence,
} from "../verification-bundle.mjs";

const addresses = {
  curveDeployer: "0x1111111111111111111111111111111111111111",
  positionLocker: "0x2222222222222222222222222222222222222222",
  graduationManager: "0x3333333333333333333333333333333333333333",
  launchFactory: "0x4444444444444444444444444444444444444444",
};
const names = ["DoomLaunchDeployerV2", "PositionLockerV2", "V3GraduationManagerV2", "DoomLaunchFactoryV2"];
const keys = Object.keys(addresses);

function evidence() {
  const plan = {
    chainId: 4663,
    transactions: names.map((contract, index) => ({
      kind: "CREATE",
      contract,
      predictedAddress: addresses[keys[index]],
      constructorSignature: "constructor(address)",
      encodedConstructorArguments: "0x00",
    })),
  };
  const record = {
    chainId: 4663,
    status: "v2_mainnet_deployment_verified_paused",
    contractDigest: "abc",
    addresses,
    verification: { allRuntimeBytecodesMatch: true, factoryPaused: true, factoryLaunchCount: 0 },
  };
  return { plan, record, manifest: { source: { contractDigest: "abc" } } };
}

test("frozen V2 deployment evidence is accepted and address drift is rejected", () => {
  const valid = evidence();
  assert.deepEqual(validateDeploymentEvidence(valid.plan, valid.record, valid.manifest), []);
  valid.record.addresses.launchFactory = addresses.curveDeployer;
  assert.ok(validateDeploymentEvidence(valid.plan, valid.record, valid.manifest).some(error => error.includes("DoomLaunchFactoryV2 address")));
});

test("frozen public V2 deployment evidence accepts the permissionless factory", () => {
  const valid = evidence();
  valid.plan.transactions[3].contract = "DoomPublicLaunchFactoryV2";
  valid.record.status = "public_v2_mainnet_deployment_verified_paused";
  assert.deepEqual(validateDeploymentEvidence(valid.plan, valid.record, valid.manifest, {
    recordStatus: "public_v2_mainnet_deployment_verified_paused",
    factoryContract: "DoomPublicLaunchFactoryV2",
  }), []);
});

test("full-scale deployment evidence accepts the uncapped factory", () => {
  const valid = evidence();
  valid.plan.transactions[3].contract = "DoomFullScaleLaunchFactoryV3";
  valid.record.status = "fullscale_v3_mainnet_deployment_verified_paused";
  assert.deepEqual(validateDeploymentEvidence(valid.plan, valid.record, valid.manifest, {
    recordStatus: "fullscale_v3_mainnet_deployment_verified_paused",
    factoryContract: "DoomFullScaleLaunchFactoryV3",
  }), []);
});

function compilerInput() {
  return {
    language: "Solidity",
    sources: { "src/DoomLaunchFactoryV2.sol": { content: "contract DoomLaunchFactoryV2 {}" } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "cancun",
      metadata: { bytecodeHash: "ipfs" },
      remappings: ["@openzeppelin/contracts/=../lib/openzeppelin-contracts/contracts/"],
    },
  };
}

test("compiler input stays pinned and contains no operational secrets", () => {
  assert.deepEqual(validateCompilerInput(compilerInput(), "DoomLaunchFactoryV2"), []);
  const wrong = compilerInput();
  wrong.settings.optimizer.runs = 999;
  wrong.sources["src/DoomLaunchFactoryV2.sol"].content += " https://example.test/?api_key=secret";
  const errors = validateCompilerInput(wrong, "DoomLaunchFactoryV2");
  assert.ok(errors.some(error => error.includes("200")));
  assert.ok(errors.some(error => error.includes("API key")));
});

test("exact local compiler paths are counted for owner privacy review", () => {
  const input = compilerInput();
  input.settings.remappings.push("forge-std/=C:/Users/owner/repo/lib/forge-std/src/");
  assert.equal(localPathRemappingCount(input), 1);
});

test("local build remappings can be replaced without exposing the owner path", () => {
  const input = compilerInput();
  input.settings.remappings.push(
    "forge-std/=C:/Users/owner/repo/lib/forge-std/src/",
    "unchanged/=https://example.test/dependency/",
  );
  const sanitized = sanitizeLocalRemappings(input);
  assert.equal(localPathRemappingCount(sanitized), 0);
  assert.ok(sanitized.settings.remappings.includes("forge-std/=../lib/forge-std/src/"));
  assert.ok(sanitized.settings.remappings.includes("unchanged/=https://example.test/dependency/"));
  assert.notEqual(sanitized, input);
  assert.equal(localPathRemappingCount(input), 1);
});

test("compiled creation bytecode and ABI must match the deployed plan", () => {
  const artifact = {
    abi: [{ type: "constructor", inputs: [{ type: "address" }] }],
    bytecode: { object: "0x6000" },
  };
  const plan = {
    constructorSignature: "constructor(address)",
    encodedConstructorArguments: "0x1234",
    data: "0x60001234",
  };
  assert.deepEqual(validateArtifactAgainstPlan(artifact, plan), []);
  plan.data = "0x60001235";
  assert.ok(validateArtifactAgainstPlan(artifact, plan)[0].includes("creation bytecode"));
});
