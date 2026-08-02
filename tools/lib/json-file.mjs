import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";

/// Shared JSON file access for every tool in this repository.
///
/// Windows PowerShell 5.1 writes a UTF-8 byte-order mark with `-Encoding utf8`, and
/// `JSON.parse` rejects a leading BOM with "Unexpected token" pointing at character 0 — a message
/// that says nothing about the real cause. That has cost this project debugging time twice, so
/// reading is tolerant of a BOM and writing can never produce one.
///
/// Writes are atomic: a temporary file in the same directory, then a rename. A crash mid-write
/// leaves the previous file intact rather than a truncated one that fails to parse on the next run.

export const BOM_CODE_POINT = 0xfeff;

export function stripBom(text) {
  const value = String(text ?? "");
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

export function hasBom(text) {
  return String(text ?? "").charCodeAt(0) === 0xfeff;
}

/// Parses JSON, naming the source in the error. A BOM is stripped rather than reported, because a
/// file written by PowerShell is still the file the operator meant to write.
export function parseJson(text, label = "JSON") {
  try {
    return JSON.parse(stripBom(text));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

export async function readJson(path) {
  return parseJson(await readFile(path, "utf8"), path);
}

export function readJsonSync(path) {
  return parseJson(readFileSync(path, "utf8"), path);
}

export function serializeJson(value, { spaces = 2 } = {}) {
  const text = JSON.stringify(value, null, spaces);
  if (text === undefined) throw new Error("value is not serializable as JSON");
  return `${text}\n`;
}

/// Writes UTF-8 without a BOM, atomically. Refuses to write a BOM even if one reached the value,
/// so a round trip through this module cannot reintroduce the problem it exists to prevent.
export async function writeJson(path, value, { spaces = 2 } = {}) {
  const text = serializeJson(value, { spaces });
  if (hasBom(text)) throw new Error("refusing to write JSON that begins with a byte-order mark");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, text, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return path;
}
