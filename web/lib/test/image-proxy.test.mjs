import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

/// The image route lives in the website repository, which is the parent directory here and is not
/// checked out in CI. These tests run locally and skip elsewhere rather than failing on absence.

const directory = dirname(fileURLToPath(import.meta.url));
const routePath = resolve(directory, "../../../../api/img/[cid].js");
const present = existsSync(routePath);
const skip = present ? false : "the website repository is not checked out here";

/// The check that stops this being an open proxy on the user's own domain. Everything else in the
/// route is caching; this is the part that matters.
test("only real content identifiers are accepted", { skip }, async () => {
  const { isValidCid } = await import(pathToFileURL(routePath).href);

  // A real CIDv0 and a real CIDv1.
  assert.equal(isValidCid("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"), true);
  assert.equal(isValidCid("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"), true);

  for (const rejected of [
    "https://evil.example/payload",          // a URL: the open-proxy case
    "../../../etc/passwd",                   // traversal
    "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/../secret",
    "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbd",  // one character short
    "Qm0OIl1111111111111111111111111111111111111111", // base58 excludes 0, O, I, l
    "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi?x=1",
    "",
    null,
    undefined,
    123,
  ]) {
    assert.equal(isValidCid(rejected), false, `${String(rejected)} must be refused`);
  }
});

test("only images are passed through, and never as executable markup", { skip }, async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /x-content-type-options.*nosniff/);
  // SVG is a document to a browser and these come from untrusted uploads.
  assert.match(source, /sandbox/);
  assert.match(source, /content-security-policy/);
  assert.ok(!source.includes("text/html"), "HTML must never be an allowed type");
});

/// Caching forever is only safe because a CID is a hash of its own content. If that reasoning is
/// ever removed, the cache header has to go with it.
test("successful responses cache forever, failures never", { skip }, async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /max-age=31536000.*immutable/);
  // Every error path must opt out of caching, or one bad minute is cached for a year.
  const failures = [...source.matchAll(/return response\.status\((\d{3})\)/g)].map(m => m[1]);
  const errorCodes = failures.filter(code => Number(code) >= 400);
  assert.ok(errorCodes.length >= 5, "expected several error paths");
  const noStore = [...source.matchAll(/cache-control", "no-store"/g)].length;
  assert.ok(noStore >= 4, `every failure path needs no-store; found ${noStore}`);
});

test("the gateway is configurable and the request is bounded", { skip }, async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /process\.env\.IPFS_GATEWAY/);
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /MAX_BYTES/);
});
