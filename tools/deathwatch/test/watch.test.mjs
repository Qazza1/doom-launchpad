import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deliverEvents, readChainHead, writeJsonAtomic } from "../watch.mjs";

test("the watcher uses the latest chain block timestamp", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { number: "0x2a", timestamp: "0x6b49d200" },
      }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const address = server.address();
  const head = await readChainHead(`http://127.0.0.1:${address.port}`);
  assert.deepEqual(head, {
    blockTag: "0x2a",
    blockNumber: 42,
    timestamp: 1_800_000_000,
  });
  assert.equal(requests[0].method, "eth_getBlockByNumber");
  assert.deepEqual(requests[0].params, ["latest", false]);
});

test("a failed delivery never advances the feed checkpoint", async () => {
  const event = {
    kind: "launched",
    severity: "info",
    entry: {
      launchId: 1,
      token: "0x1111111111111111111111111111111111111111",
      creator: "0x2222222222222222222222222222222222222222",
      symbol: "DOOM",
      checkInsDone: 0,
      checkInsRequired: 3,
      atStakeFormatted: "600000000",
    },
  };
  const checkpoints = [];
  await assert.rejects(
    deliverEvents({
      events: [event],
      previousEntries: [{ launchId: 1, phase: "waiting" }],
      currentEntries: [{ launchId: 1, phase: "window_open" }],
      send: async () => {
        throw new Error("Telegram unavailable");
      },
      checkpoint: async state => checkpoints.push(state),
    }),
    /Telegram unavailable/,
  );
  assert.deepEqual(checkpoints, []);
});

test("partial delivery checkpoints IDs without consuming unsent events", async () => {
  const entry = id => ({
    launchId: id,
    token: `0x${String(id).repeat(40).slice(0, 40)}`,
    creator: "0x2222222222222222222222222222222222222222",
    symbol: `DOOM${id}`,
    checkInsDone: 0,
    checkInsRequired: 3,
    atStakeFormatted: "600000000",
  });
  const events = [
    { kind: "launched", severity: "info", entry: entry(1) },
    { kind: "launched", severity: "info", entry: entry(2) },
  ];
  const checkpoints = [];
  let attempts = 0;
  await assert.rejects(
    deliverEvents({
      events,
      previousEntries: [],
      currentEntries: events.map(item => item.entry),
      send: async () => {
        attempts += 1;
        if (attempts === 2) throw new Error("second delivery failed");
      },
      checkpoint: async state => checkpoints.push(structuredClone(state)),
    }),
    /second delivery failed/,
  );

  assert.equal(checkpoints.length, 1);
  assert.deepEqual(checkpoints[0].entries, []);
  assert.deepEqual(checkpoints[0].deliveredEventIds, ["deathwatch:launched:1:0"]);

  const retried = [];
  const completed = [];
  await deliverEvents({
    events,
    previousEntries: [],
    currentEntries: events.map(item => item.entry),
    deliveredEventIds: checkpoints[0].deliveredEventIds,
    send: async alert => retried.push(alert.id),
    checkpoint: async state => completed.push(structuredClone(state)),
  });
  assert.deepEqual(retried, ["deathwatch:launched:2:0"]);
  assert.deepEqual(completed.at(-1), {
    entries: events.map(item => item.entry),
    deliveredEventIds: [],
  });
});

test("atomic checkpoints can safely replace an existing Windows file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "doom-deathwatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "checkpoint.json");

  await writeJsonAtomic(path, { sequence: 1 });
  await writeJsonAtomic(path, { sequence: 2 });

  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { sequence: 2 });
});
