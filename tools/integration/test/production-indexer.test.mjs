import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");
const integration = JSON.parse(
  readFileSync(resolve(projectRoot, "integration/indexer/doom-launchpad-events.json"), "utf8"),
);
const configuredPath = process.env.DOOM_PRODUCTION_INDEXER_ABI;
const productionAbiPath = configuredPath
  ? resolve(projectRoot, configuredPath)
  : resolve(projectRoot, "../stage34-indexer/doom-launchpad-abis.js");
const available = existsSync(productionAbiPath);

test(
  "the deployed indexer consumes the exact frozen event contract",
  { skip: !available && !configuredPath ? "production indexer checkout is not present" : false },
  async () => {
    assert.ok(
      available,
      `production indexer ABI not found at ${productionAbiPath}`,
    );
    const production = await import(pathToFileURL(productionAbiPath).href);
    assert.equal(production.DOOM_EVENT_SCHEMA_VERSION, integration.version);
    assert.deepEqual(
      Object.keys(production.DOOM_EVENT_ABIS).sort(),
      Object.keys(integration.contracts).sort(),
    );
    for (const contract of Object.keys(integration.contracts)) {
      assert.deepEqual(
        [...production.DOOM_EVENT_ABIS[contract]].sort(),
        [...integration.contracts[contract]].sort(),
        `${contract} differs between the contract repo and production indexer`,
      );
    }
  },
);
