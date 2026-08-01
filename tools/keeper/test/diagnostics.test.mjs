import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorClass } from "../lib/diagnostics.mjs";

test("RPC diagnostics expose classes without leaking endpoint messages", () => {
  const inner = new Error("https://provider.example/SECRET_API_KEY");
  inner.name = "HttpRequestError";
  inner.code = "ETIMEDOUT";
  const outer = new Error("request failed", { cause: inner });
  outer.name = "ContractFunctionExecutionError";
  const summary = safeErrorClass(outer);
  assert.equal(summary, "ContractFunctionExecutionError/HttpRequestError/ETIMEDOUT");
  assert.equal(summary.includes("SECRET_API_KEY"), false);
  assert.equal(summary.includes("https://"), false);
});
