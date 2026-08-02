import {
  checkInSchedule,
  describeLaunch,
  loadEconomics,
  splitFee,
  splitSupply,
  validateTokenInputs,
} from "./economics.mjs";
import { SELECTORS } from "./selectors.mjs";

/// Stage 6 guided launch flow, prototype.
///
/// Two rules this file exists to honour:
///   1. Every number shown comes from the frozen configuration or the chain. Nothing is typed into
///      the interface, so the interface cannot promise something the contracts do not do.
///   2. There is no send path. The public factory does not exist yet, and the deployed one is
///      limited by its own code to three test launches. The button says why it is disabled instead
///      of pretending to work.

const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const FACTORY = "0xDC0DF0Ba9e519D1E082F8B45307450F418eED9dE";
const CHAIN_ID = 4663;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;


const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const state = {
  step: 1,
  economics: null,
  limits: { minWholeSupply: 1_000_000n, maxWholeSupply: 1_000_000_000_000_000n },
  nativeLiquidityWei: 10_000_000_000_000_000n,
  chain: null,
  inputs: { name: "", symbol: "", wholeSupply: "1000000000" },
};

const number = value => Number(value).toLocaleString("en-US");
const bigNumber = value => BigInt(value).toLocaleString("en-US");
const percent = bps => `${bps / 100}%`;
const eth = wei => {
  const whole = BigInt(wei) / 10n ** 18n;
  const fraction = (BigInt(wei) % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
};
const when = seconds => new Date(seconds * 1000).toUTCString().replace("GMT", "UTC");

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || "RPC error");
  return body.result;
}

/// Asks the chain whether a launch is even possible, rather than assuming. A prototype that claimed
/// it could launch and then failed at the wallet would be worse than one that says so up front.
async function readCapability() {
  const banner = $("#capability");
  try {
    const chainId = Number(await rpc("eth_chainId"));
    if (chainId !== CHAIN_ID) throw new Error(`endpoint is on chain ${chainId}`);
    const call = data => rpc("eth_call", [{ to: FACTORY, data }, "latest"]);
    const [paused, count, max] = await Promise.all([
      call(SELECTORS["launchesPaused()"]),
      call(SELECTORS["launchCount()"]),
      call(SELECTORS["maxLaunches()"]),
    ]);
    state.chain = {
      paused: BigInt(paused) === 1n,
      launchCount: BigInt(count),
      maxLaunches: BigInt(max),
    };
    const remaining = state.chain.maxLaunches - state.chain.launchCount;
    banner.innerHTML =
      `<b>This prototype cannot launch anything.</b> The deployed factory has used `
      + `${state.chain.launchCount} of its ${state.chain.maxLaunches} launches and only its `
      + `approved test account may call it. The public factory that would serve this page has not `
      + `been built yet. ${remaining > 0n ? `${remaining} test launch(es) remain, and each needs its own owner approval.` : ""}`;
  } catch (error) {
    // Failing to read the chain is itself a state worth showing honestly.
    banner.innerHTML =
      `<b>This prototype cannot launch anything.</b> It also could not reach the chain to check the `
      + `current limits (${error.message}). Nothing below depends on that read; the figures come `
      + `from the frozen configuration.`;
  }
}

function setStep(step) {
  state.step = step;
  for (const panel of $$("section.card")) {
    panel.hidden = Number(panel.dataset.panel) !== step;
  }
  for (const pip of $$(".pip")) {
    const index = Number(pip.dataset.step);
    pip.dataset.state = index === step ? "active" : index < step ? "done" : "";
  }
  if (step === 3) renderReview();
  if (step === 4) renderConfirm();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function readInputs() {
  state.inputs = {
    name: $("#name").value,
    symbol: $("#symbol").value,
    wholeSupply: $("#supply").value,
  };
  return state.inputs;
}

function showValidation() {
  const { errors } = validateTokenInputs(readInputs(), state.limits);
  $("#nameError").textContent = errors.name ?? "";
  $("#symbolError").textContent = errors.symbol ?? "";
  $("#supplyError").textContent = errors.wholeSupply ?? "";
  $("#toReview").disabled = Object.keys(errors).length > 0;
  return Object.keys(errors).length === 0;
}

function rows(table, entries) {
  table.replaceChildren();
  for (const [label, value, kind] of entries) {
    const tr = document.createElement("tr");
    if (kind === "total") tr.className = "total";
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    if (kind === "note") td.className = "note";
    td.textContent = value;
    tr.append(th, td);
    table.append(tr);
  }
}

function renderReview() {
  const { supply } = validateTokenInputs(readInputs(), state.limits);
  const economics = state.economics;
  const split = splitSupply(supply, economics);
  const fee = splitFee(state.nativeLiquidityWei, economics);
  const schedule = checkInSchedule(Math.floor(Date.now() / 1000), economics);

  rows($("#reviewTable"), [
    ["Token", `${state.inputs.name.trim()} (${state.inputs.symbol.trim().toUpperCase()})`],
    ["Total supply", `${bigNumber(supply)} tokens`],
    [`You receive at launch (${percent(economics.creatorLiquidBps)})`, `${bigNumber(split.creator)} tokens`],
    [`Permanent liquidity (${percent(economics.liquidityBps)})`, `${bigNumber(split.liquidity)} tokens`],
    [`Held in escrow (${percent(economics.gmEscrowBps)})`, `${bigNumber(split.escrow)} tokens`],
    [`Released per check-in`, `${bigNumber(split.perCheckIn)} tokens`],
    ["Liquidity you provide", `${eth(state.nativeLiquidityWei)} ETH`],
    [`Creation fee (${percent(economics.creationFeeBps)})`, `${eth(fee.fee)} ETH`],
    ["Total your wallet will send", `${eth(fee.total)} ETH`, "total"],
  ]);

  const list = $("#warnings");
  list.replaceChildren();
  const points = [
    `You receive ${bigNumber(split.creator)} tokens at launch. Not a share, not a vesting schedule — nothing.`,
    `The ${eth(state.nativeLiquidityWei)} ETH and ${bigNumber(split.liquidity)} tokens go into a pool that is locked forever. `
      + "Nobody can withdraw it: not you, not us. There is no release function in the contract.",
    `You must check in ${economics.requiredCheckIns} times, once every `
      + `${economics.cadenceSeconds / 3600} hours, each within a `
      + `${economics.gracePeriodSeconds / 3600}-hour window. First window if you launched now: `
      + `${when(schedule[0].opensAt)} to ${when(schedule[0].closesAt)}.`,
    `Each check-in releases ${bigNumber(split.perCheckIn)} tokens to you. Miss one and everything not `
      + "yet released goes to the rewards vault permanently. Anyone can trigger that, and check-ins you "
      + "already made are never taken back.",
    `Your income is trading fees, not your token balance: `
      + `${economics.eligibleWethFeeSplitBps.creator / 100}% of the ETH-side fees while your streak is alive. `
      + "If you dump what you are released into your own thin pool, you get back less than you put in and "
      + "you destroy the fee stream. That is the design, and you should know it now rather than later.",
  ];
  for (const point of points) {
    const item = document.createElement("li");
    item.textContent = point;
    list.append(item);
  }
}

function renderConfirm() {
  const { supply } = validateTokenInputs(readInputs(), state.limits);
  const fee = splitFee(state.nativeLiquidityWei, state.economics);
  rows($("#confirmTable"), [
    ["Network", `Robinhood Chain (${CHAIN_ID})`],
    ["Contract", FACTORY],
    ["Function", "launch((string,string,uint256,uint256))"],
    ["Value", `${eth(fee.total)} ETH`],
    ["Token", `${state.inputs.name.trim()} (${state.inputs.symbol.trim().toUpperCase()})`],
    ["Supply", `${bigNumber(supply)} tokens`],
  ]);

  const button = $("#launch");
  button.disabled = true;
  $("#launchWhy").textContent =
    "Disabled on purpose. The deployed factory only accepts its approved test account and is capped "
    + "at three launches by its own code, and the public factory does not exist yet. When it does, this "
    + "button will still be disabled until the plan, the fork rehearsal, and the wallet comparison all pass.";
}

function showState(name) {
  const description = {
    pending: describeLaunch({ receiptStatus: null }),
    reverted: describeLaunch({ receiptStatus: 0 }),
    indexing: describeLaunch({ receiptStatus: 1, confirmations: 40, indexed: false, indexerHealthy: false }),
    listed: describeLaunch({ receiptStatus: 1, confirmations: 12, indexed: true }),
  }[name];
  const panel = $("#status");
  panel.dataset.tone = description.tone;
  panel.querySelector("b").textContent = description.label;
  panel.querySelector("p").textContent = description.detail;
}

function wireImage() {
  const input = $("#image");
  $("#drop").addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    const error = $("#imageError");
    const preview = $("#preview");
    error.textContent = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      error.textContent = `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`;
      input.value = "";
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    $("#dropText").textContent = `${file.name} — stays in your browser.`;
  });
}

async function start() {
  const response = await fetch("/config/robinhood-mainnet-canary.decisions.json");
  const decisions = await response.json();
  state.economics = loadEconomics(decisions);
  state.nativeLiquidityWei = BigInt(decisions.pilotLimits.maxNativeLiquidityPerLaunchWei);

  wireImage();
  for (const button of $$("[data-go]")) {
    button.addEventListener("click", () => {
      const target = Number(button.dataset.go);
      if (target > 2 && !showValidation()) {
        setStep(2);
        return;
      }
      setStep(target);
    });
  }
  for (const field of ["#name", "#symbol", "#supply"]) {
    $(field).addEventListener("input", showValidation);
  }
  for (const button of $$(".statepick button")) {
    button.addEventListener("click", () => showState(button.dataset.state));
  }
  showValidation();
  setStep(1);
  await readCapability();
}

start();
