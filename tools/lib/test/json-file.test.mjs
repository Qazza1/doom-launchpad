import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  hasBom,
  parseJson,
  readJson,
  readJsonSync,
  serializeJson,
  stripBom,
  writeJson,
} from "../json-file.mjs";

const directory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(directory, "../../..");
const BOM = String.fromCharCode(0xfeff);

async function scratch() {
  return mkdtemp(join(tmpdir(), "doom-json-"));
}

test("a byte-order mark is stripped rather than parsed", () => {
  assert.equal(stripBom(`${BOM}{}`), "{}");
  assert.equal(stripBom("{}"), "{}");
  assert.equal(hasBom(`${BOM}{}`), true);
  assert.equal(hasBom("{}"), false);
  assert.deepEqual(parseJson(`${BOM}{"a":1}`), { a: 1 });
});

test("a parse failure names the file it came from", () => {
  assert.throws(
    () => parseJson("{ not json", "config/example.json"),
    /config\/example\.json is not valid JSON/,
  );
});

test("reading tolerates a PowerShell 5.1 BOM in both modes", async () => {
  const folder = await scratch();
  try {
    const path = join(folder, "bom.json");
    await writeFile(path, `${BOM}{"chainId":4663}\n`, "utf8");
    assert.deepEqual(await readJson(path), { chainId: 4663 });
    assert.deepEqual(readJsonSync(path), { chainId: 4663 });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("writing produces UTF-8 with no BOM and a trailing newline", async () => {
  const folder = await scratch();
  try {
    const path = join(folder, "nested", "out.json");
    await writeJson(path, { chainId: 4663, note: "café" });
    const bytes = await readFile(path);
    assert.notEqual(bytes[0], 0xef, "file must not start with a UTF-8 BOM");
    const text = bytes.toString("utf8");
    assert.equal(hasBom(text), false);
    assert.ok(text.endsWith("}\n"));
    assert.deepEqual(JSON.parse(text), { chainId: 4663, note: "café" });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("a write leaves no temporary file behind and replaces the previous contents", async () => {
  const folder = await scratch();
  try {
    const path = join(folder, "out.json");
    await writeJson(path, { launchCount: 0 });
    await writeJson(path, { launchCount: 1 });
    assert.deepEqual(await readJson(path), { launchCount: 1 });
    assert.deepEqual(await readdir(folder), ["out.json"]);
    assert.ok((await stat(path)).isFile());
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("a value that cannot be serialized is refused rather than written", async () => {
  const folder = await scratch();
  try {
    assert.throws(() => serializeJson(undefined), /not serializable/);
    await assert.rejects(writeJson(join(folder, "bad.json"), 1n), /BigInt|serializ/i);
    assert.deepEqual(await readdir(folder), []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

/// The regression guard. Every JSON file the tools read must parse today, and none may carry a BOM,
/// whoever wrote it and with whatever editor.
test("no committed JSON file carries a byte-order mark", async () => {
  const roots = ["config", "integration", "docs", "tools"];
  const skip = new Set(["node_modules", "out", "output", "state", "cache", "broadcast"]);
  const offenders = [];
  const unparsable = [];

  const walk = async folder => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) await walk(path);
      } else if (entry.name.endsWith(".json")) {
        const text = await readFile(path, "utf8");
        if (hasBom(text)) offenders.push(path);
        try {
          JSON.parse(stripBom(text));
        } catch (error) {
          unparsable.push(`${path}: ${error.message}`);
        }
      }
    }
  };

  for (const root of roots) await walk(resolve(projectRoot, root));
  assert.deepEqual(offenders, [], "rewrite these without a BOM; see tools/lib/Json.ps1");
  assert.deepEqual(unparsable, []);
});

/// `-Encoding utf8` in Windows PowerShell 5.1 means "UTF-8 with a BOM". Nothing in this repository
/// may use it to write a file another tool parses.
test("no PowerShell script writes a file with the BOM-producing encoding", async () => {
  const offenders = [];
  const walk = async folder => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") await walk(path);
      } else if (entry.name.endsWith(".ps1")) {
        const text = await readFile(path, "utf8");
        for (const [index, line] of text.split(/\r?\n/).entries()) {
          if (/-Encoding\s+utf8(?!NoBOM)/i.test(line) && !/^\s*#/.test(line)) {
            offenders.push(`${path}:${index + 1}`);
          }
        }
      }
    }
  };
  await walk(resolve(projectRoot, "tools"));
  assert.deepEqual(offenders, [], "use Write-JsonFile from tools/lib/Json.ps1 instead");
});
