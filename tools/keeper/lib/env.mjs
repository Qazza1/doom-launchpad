import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadKeeperEnv() {
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
