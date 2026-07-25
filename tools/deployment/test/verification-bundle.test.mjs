import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXPECTED_COMPILER,
  canonicalType,
  checkExplorerSupport,
  compareRuntimeBytecode,
  constructorSignature,
  castArgument,
  findSecrets,
  maskImmutables,
  planConstructorArguments,
  resolveDeploymentInputs,
  validateStandardJsonInput,
} from "../verification-bundle.mjs";

const manifest = JSON.parse(
  await readFile(new URL("../../../config/stage4-deployment-manifest.json", import.meta.url), "utf8"),
);
const decisions = JSON.parse(
  await readFile(
    new URL("../../../config/robinhood-mainnet-canary.decisions.json", import.meta.url),
    "utf8",
  ),
);

const deployed = {
  DoomRewards: "0x615f6E6B0AEA7Ac94F4391424aF601F9290dd9dC",
  PositionLocker: "0xdaE01c32131fF283f403b4C1fD71018Fa31cfAC0",
  V3LiquidityManager: "0xbf36be8861ca4fe9920B10fc526E3fD039F88519",
};
const validInput = () => ({
  language: "Solidity",
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "cancun",
    metadata: { bytecodeHash: "ipfs" },
  },
  sources: { "src/DoomRewards.sol": { content: "// SPDX-License-Identifier: MIT" } },
});

test("the committed configuration files agree on every deployment input", () => {
  const { errors, inputs } = resolveDeploymentInputs(manifest, decisions);
  assert.deepEqual(errors, []);
  assert.equal(inputs.chainId, 4663);
  assert.equal(inputs.minimumClaimWindowSeconds, 604800);
  assert.equal(inputs.maxLaunches, 3);
  assert.equal(inputs.maxNativeLiquidityPerLaunchWei, "10000000000000000");
});

test("a dependency that drifts between the two configuration files is rejected", () => {
  const drifted = structuredClone(manifest);
  drifted.dependencies.wrappedNative = "0x1111111111111111111111111111111111111111";
  const wrongCreator = structuredClone(manifest);
  wrongCreator.roles.approvedCreator = "0x2222222222222222222222222222222222222222";

  assert.ok(
    resolveDeploymentInputs(drifted, decisions).errors.some(error =>
      error.includes("wrapped native token differs")
    ),
  );
  assert.ok(
    resolveDeploymentInputs(wrongCreator, decisions).errors.some(error =>
      error.includes("approved creator differs")
    ),
  );
});

test("constructor arguments follow the frozen canary economics", () => {
  const { inputs } = resolveDeploymentInputs(manifest, decisions);
  const { errors, values } = planConstructorArguments(inputs, deployed);
  assert.deepEqual(errors, []);

  assert.deepEqual(values.DoomRewards, [
    manifest.roles.campaignManager,
    manifest.dependencies.nftCollection,
    manifest.roles.treasury,
    manifest.dependencies.wrappedNative,
    "604800",
  ]);
  assert.equal(values.PositionLocker[2], deployed.DoomRewards);
  assert.equal(values.V3LiquidityManager[0], "4663");
  assert.equal(values.V3LiquidityManager[5], deployed.PositionLocker);

  const [config] = values.DoomLaunchFactory;
  assert.equal(config[4], deployed.DoomRewards);
  assert.equal(config[6], deployed.V3LiquidityManager);
  assert.equal(config[7], deployed.PositionLocker);
  assert.deepEqual(config.slice(8), ["3", "10000000000000000", "30000000000000000"]);
});

test("constructor arguments fail closed when a deployed address is missing or zero", () => {
  const { inputs } = resolveDeploymentInputs(manifest, decisions);

  const missing = planConstructorArguments(inputs, { ...deployed, PositionLocker: undefined });
  assert.equal(missing.values, null);
  assert.ok(missing.errors.some(error => error.includes("PositionLocker address is missing")));

  const zeroed = planConstructorArguments(inputs, {
    ...deployed,
    DoomRewards: "0x0000000000000000000000000000000000000000",
  });
  assert.equal(zeroed.values, null);
  assert.ok(zeroed.errors.some(error => error.includes("must not be the zero address")));
});

test("the constructor signature comes from the compiled ABI, including struct widths", () => {
  const factoryAbi = [{
    type: "constructor",
    inputs: [{
      name: "config_",
      type: "tuple",
      components: [
        { name: "operator", type: "address" },
        { name: "maxLaunches", type: "uint32" },
        { name: "maxNativeLiquidityGlobal", type: "uint256" },
      ],
    }],
  }];
  assert.equal(
    constructorSignature(factoryAbi),
    "constructor((address,uint32,uint256))",
  );
  assert.equal(
    constructorSignature([{ type: "constructor", inputs: [{ type: "address" }, { type: "uint64" }] }]),
    "constructor(address,uint64)",
  );
  assert.equal(canonicalType({ type: "tuple[]", components: [{ type: "address" }] }), "(address)[]");
  assert.equal(castArgument(["0xabc", "3"]), "(0xabc,3)");
  assert.throws(() => constructorSignature([]), /no constructor/);
});

test("compiler input must match the frozen compiler settings", () => {
  assert.deepEqual(validateStandardJsonInput(validInput(), "src/DoomRewards.sol", "{}"), []);

  const cases = [
    [input => (input.settings.optimizer.enabled = false), "optimizer must stay enabled"],
    [input => (input.settings.optimizer.runs = 999), "optimizer runs must be 200"],
    [input => (input.settings.viaIR = false), "viaIR must stay enabled"],
    [input => (input.settings.evmVersion = "shanghai"), "evmVersion must be cancun"],
    [input => (input.settings.metadata.bytecodeHash = "none"), "bytecodeHash must be ipfs"],
    [input => (input.language = "Vyper"), "language must be Solidity"],
  ];
  for (const [mutate, expected] of cases) {
    const input = validInput();
    mutate(input);
    assert.ok(
      validateStandardJsonInput(input, "src/DoomRewards.sol", "{}").some(error =>
        error.includes(expected)
      ),
      `expected "${expected}"`,
    );
  }
});

test("compiler input must inline every source under a relative path", () => {
  const missing = validInput();
  missing.sources = { "src/Other.sol": { content: "contract Other {}" } };
  assert.ok(
    validateStandardJsonInput(missing, "src/DoomRewards.sol", "{}").some(error =>
      error.includes("missing src/DoomRewards.sol")
    ),
  );

  const absolute = validInput();
  absolute.sources["C:/Users/owner/doom/src/DoomRewards.sol"] = { content: "contract A {}" };
  assert.ok(
    validateStandardJsonInput(absolute, "src/DoomRewards.sol", "{}").some(error =>
      error.includes("is absolute")
    ),
  );

  const empty = validInput();
  empty.sources["src/DoomRewards.sol"] = { content: "" };
  assert.ok(
    validateStandardJsonInput(empty, "src/DoomRewards.sol", "{}").some(error =>
      error.includes("no inlined content")
    ),
  );
});

test("a byte-order mark or an embedded secret blocks the bundle", () => {
  assert.ok(
    validateStandardJsonInput(validInput(), "src/DoomRewards.sol", "\ufeff{}").some(error =>
      error.includes("byte-order mark")
    ),
  );
  assert.deepEqual(findSecrets("contract DoomRewards {}"), []);
  assert.ok(findSecrets("https://rh-mainnet.g.alchemy.com/v2/abc")[0].includes("Alchemy"));
  assert.ok(findSecrets("?apiKey=redacted")[0].includes("API key"));
  assert.ok(findSecrets("1234567890:AAF-abcdefghijklmnopqrstuvwxyz012345678")[0].includes("Telegram"));
  assert.ok(findSecrets("C:\\Users\\owner\\doom-launchpad")[0].includes("Windows absolute path"));
});

test("runtime comparison masks immutables and still catches real code changes", () => {
  const immutableReferences = { "101": [{ start: 2, length: 4 }], "102": [{ start: 10, length: 2 }] };
  const artifact = "0xaabbccddeeff00112233445566778899";
  const deployedCode = "0xAA11223344FF001122AABB66778899".padEnd(artifact.length, "0");

  assert.equal(
    maskImmutables("0xffffffff", { "1": [{ start: 1, length: 2 }] }),
    "0xff0000ff",
  );
  assert.equal(
    compareRuntimeBytecode(artifact, artifact, immutableReferences).matches,
    true,
  );

  const onlyImmutablesDiffer = `0xaabb${"11".repeat(4)}${artifact.slice(14)}`;
  const comparison = compareRuntimeBytecode(onlyImmutablesDiffer, artifact, immutableReferences);
  assert.equal(comparison.matches, true, comparison.reason);

  const tampered = `0xaabbccddeeff0011223344556677889a`;
  assert.equal(compareRuntimeBytecode(tampered, artifact, immutableReferences).matches, false);
  assert.equal(compareRuntimeBytecode("0x", artifact, immutableReferences).matches, false);
  assert.equal(
    compareRuntimeBytecode(deployedCode.slice(0, 10), artifact, immutableReferences).matches,
    false,
  );
  assert.throws(
    () => maskImmutables("0xaabb", { "1": [{ start: 1, length: 8 }] }),
    /outside the runtime bytecode/,
  );
  assert.throws(() => maskImmutables("0xzz", {}), /not a hex string/);
});

test("explorer support is read with GET and requires the exact pinned compiler", async () => {
  const calls = [];
  const respond = body => async (url, options) => {
    calls.push({ url, method: options.method });
    return { ok: true, json: async () => body };
  };

  const healthy = await checkExplorerSupport(
    respond({
      verification_options: ["flattened-code", "standard-input"],
      solidity_compiler_versions: ["v0.8.35+commit.aaaaaaaa", `v${EXPECTED_COMPILER}`],
    }),
  );
  assert.deepEqual(healthy.errors, []);
  assert.equal(healthy.standardInputSupported, true);
  assert.equal(healthy.compilerAvailable, true);
  assert.deepEqual(calls.map(call => call.method), ["GET"]);

  const unusable = await checkExplorerSupport(
    respond({
      verification_options: ["flattened-code"],
      solidity_compiler_versions: ["v0.8.35+commit.aaaaaaaa"],
    }),
  );
  assert.equal(unusable.errors.length, 2);
  assert.ok(unusable.errors.some(error => error.includes("standard-input")));
  assert.ok(unusable.errors.some(error => error.includes(EXPECTED_COMPILER)));

  await assert.rejects(
    checkExplorerSupport(async () => ({ ok: false, status: 503 })),
    /HTTP 503/,
  );
});
