import { resolve } from "node:path";
import { parseArgs, readJson, verifyManifest } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), ["manifest"]);
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const manifest = await readJson(resolve(invocationDirectory, args.manifest));
const snapshot = args.snapshot ? await readJson(resolve(invocationDirectory, args.snapshot)) : undefined;
const campaign = args.campaign ? await readJson(resolve(invocationDirectory, args.campaign)) : undefined;
const result = verifyManifest(manifest, snapshot, campaign);

console.log("Manifest verification: PASS");
console.log(JSON.stringify(result, null, 2));
