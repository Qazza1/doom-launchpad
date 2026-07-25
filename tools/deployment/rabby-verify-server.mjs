import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

export const EXPECTED_ADDRESS = "0xcaB166ed15e63b846Ec8D1a2d6762a33392c796F";
export const CHAIN_ID = 4663;
const HOST = "127.0.0.1";
const PORT = 4178;
const directory = dirname(fileURLToPath(import.meta.url));

export function createChallenge(id = randomUUID()) {
  return [
    "DoomStreak Stage 4 Rabby control check",
    "Chain: Robinhood Chain Mainnet (4663)",
    `Deployer: ${EXPECTED_ADDRESS}`,
    `Challenge: ${id}`,
    "Purpose: prove control of the dedicated canary account only",
    "This is not a transaction and authorizes no deployment.",
  ].join("\n");
}

export function validateVerificationPayload(payload, expectedMessage) {
  const errors = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["request body must be an object"];
  }
  if (typeof payload.address !== "string" ||
      payload.address.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
    errors.push("connected address does not match the approved deployer");
  }
  if (payload.message !== expectedMessage) errors.push("challenge message mismatch");
  if (typeof payload.signature !== "string" ||
      !/^0x[0-9a-fA-F]{130}$/.test(payload.signature)) {
    errors.push("signature has an unexpected format");
  }
  return errors;
}

function findCast() {
  const candidates = [
    resolve(directory, "../../../.tools/foundry-v1.7.1/cast.exe"),
    resolve(process.env.USERPROFILE || "", ".foundry/bin/cast.exe"),
  ];
  return candidates.find(existsSync);
}

function verifySignature(castPath, message, signature) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      castPath,
      ["wallet", "verify", "--address", EXPECTED_ADDRESS, message, signature],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", chunk => {
      if (stderr.length < 4096) stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || "signature recovery failed"));
    });
  });
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 16_384) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startServer() {
  const castPath = findCast();
  if (!castPath) throw new Error("Foundry cast v1.7.1 was not found");

  const challenge = createChallenge();
  let consumed = false;
  const html = await readFile(resolve(directory, "rabby-verify.html"));
  const clientScript = await readFile(resolve(directory, "rabby-verify.js"));
  const baseUrl = `http://${HOST}:${PORT}`;

  const server = createServer(async (request, response) => {
    response.setHeader(
      "content-security-policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'",
    );
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("x-frame-options", "DENY");

    try {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(html);
        return;
      }
      if (request.method === "GET" && request.url === "/rabby-verify.js") {
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(clientScript);
        return;
      }
      if (request.method === "GET" && request.url === "/challenge") {
        sendJson(response, 200, {
          expectedAddress: EXPECTED_ADDRESS,
          chainId: CHAIN_ID,
          message: challenge,
        });
        return;
      }
      if (request.method === "POST" && request.url === "/verify") {
        if (request.headers.origin !== baseUrl) {
          sendJson(response, 403, { ok: false, error: "invalid request origin" });
          return;
        }
        if (consumed) {
          sendJson(response, 409, { ok: false, error: "challenge already consumed" });
          return;
        }
        const payload = await readJson(request);
        const errors = validateVerificationPayload(payload, challenge);
        if (errors.length) {
          sendJson(response, 400, { ok: false, error: errors.join("; ") });
          return;
        }
        await verifySignature(castPath, challenge, payload.signature);
        consumed = true;
        sendJson(response, 200, {
          ok: true,
          address: EXPECTED_ADDRESS,
          chainId: CHAIN_ID,
          message: "Rabby control verification passed. No transaction was created or broadcast.",
        });
        return;
      }
      sendJson(response, 404, { ok: false, error: "not found" });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "request failed" });
    }
  });

  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolvePromise);
  });
  console.log(`Rabby verifier ready: ${baseUrl}`);
  console.log(`Expected address: ${EXPECTED_ADDRESS}`);
  console.log("This localhost tool can only request accounts and sign one text message.");
  console.log("It has no transaction creation or broadcast endpoint.");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(error => {
    console.error(`Rabby verifier failed: ${error.message}`);
    process.exitCode = 1;
  });
}
