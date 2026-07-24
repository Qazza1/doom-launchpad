import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { generateManifest, parseArgs, prettyJson, readJson, verifyManifest } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), ["snapshot", "campaign", "output"]);
const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
const snapshot = await readJson(resolve(invocationDirectory, args.snapshot));
const campaign = await readJson(resolve(invocationDirectory, args.campaign));
const manifest = generateManifest(snapshot, campaign);
verifyManifest(manifest, snapshot, campaign);

const output = resolve(invocationDirectory, args.output);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, prettyJson(manifest), { encoding: "utf8", flag: "wx" });
console.log(`Wrote verified manifest: ${output}`);
console.log(`Campaign creation permitted: ${manifest.campaign.canCreateCampaign}`);
console.log(`Merkle root: ${manifest.merkle.root ?? "<none>"}`);
