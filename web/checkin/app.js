/// The one page in this repository with a send path, and it is deliberately the narrowest one that
/// can exist.
///
/// Rabby has no field for raw calldata, and the escrow is not verified on the explorer, so it has
/// no Write tab either. Without this page there is no way to make the check-in from a normal
/// wallet, and a missed window costs the whole unreleased allocation.
///
/// What it can send is fixed in code: `recordGm()`, zero value, to an address that must first read
/// back as a GmEscrow whose creator is the connected account, on chain 4663, inside an open window.
/// Anything else and the button stays disabled. There is no other transaction it can construct.

const CHAIN_ID = 4663;
const CHAIN_HEX = "0x1237";
const DEFAULT_ESCROW = "0x19b0780f01567c1c05349a1d8a113042c4cd07ed";
const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

/// From the compiled GmEscrow artifact. web/checkin/test/selectors.test.mjs fails the build if any
/// of these stops matching.
const SELECTORS = {
  "recordGm()": "0x595100fc",
  "status()": "0x200d2ed2",
  "completedCheckIns()": "0x60e0ed15",
  "requiredCheckIns()": "0xb371c14e",
  "committedAmount()": "0xb1688f63",
  "nextCheckInAt()": "0xe23c7430",
  "nextDeadline()": "0x20517984",
  "creator()": "0x02d05d3f",
};

const $ = selector => document.querySelector(selector);
const escrow = (new URLSearchParams(location.search).get("escrow") ?? DEFAULT_ESCROW).toLowerCase();
const state = { ready: false, creator: null };

let wallet;
window.addEventListener("eip6963:announceProvider", event => {
  if (!wallet) wallet = event.detail?.provider;
  if (event.detail?.info?.rdns === "io.rabby") wallet = event.detail.provider;
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function setStatus(message, tone = "") {
  $("#status").textContent = message;
  $("#status").dataset.tone = tone;
}

async function rpc(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || `${method} failed`);
  return body.result;
}

function rows(table, entries) {
  table.replaceChildren();
  for (const [label, value] of entries) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    table.append(tr);
  }
}

const iso = seconds => (Number(seconds)
  ? `${new Date(Number(seconds) * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`
  : "—");

function gap(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 1) return `${hours}h ${minutes}m`;
  if (minutes >= 1) return `${minutes}m ${total % 60}s`;
  return `${total}s`;
}

async function refresh() {
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  const at = block.number;
  const call = data => rpc("eth_call", [{ to: escrow, data }, at]);
  const value = async name => BigInt(await call(SELECTORS[name]));

  const [status, done, required, committed, opens, closes, creatorWord] = await Promise.all([
    value("status()"),
    value("completedCheckIns()"),
    value("requiredCheckIns()"),
    value("committedAmount()"),
    value("nextCheckInAt()"),
    value("nextDeadline()"),
    call(SELECTORS["creator()"]),
  ]);

  const creator = `0x${creatorWord.slice(-40)}`;
  const now = Number(BigInt(block.timestamp));
  const perCheckIn = committed / (required || 1n);
  state.creator = creator;

  rows($("#state"), [
    ["Escrow", escrow],
    ["Status", ["Active", "Completed", "Defaulted"][Number(status)] ?? String(status)],
    ["Check-ins", `${done}/${required}`],
    ["This one releases", `${(perCheckIn / 10n ** 18n).toLocaleString("en-US")} tokens`],
    ["Window opens", iso(opens)],
    ["Window closes", iso(closes)],
  ]);
  rows($("#call"), [
    ["To", escrow],
    ["Value", "0"],
    ["Data", SELECTORS["recordGm()"]],
    ["Function", "recordGm()"],
  ]);

  const badge = document.createElement("span");
  badge.className = "badge";
  let ready = false;
  if (Number(status) === 1) {
    badge.textContent = "Streak complete — nothing to do";
    badge.dataset.tone = "good";
  } else if (Number(status) === 2) {
    badge.textContent = "Defaulted — a check-in would revert";
    badge.dataset.tone = "bad";
  } else if (now > Number(closes)) {
    badge.textContent = `Window closed ${gap(now - Number(closes))} ago`;
    badge.dataset.tone = "bad";
  } else if (now < Number(opens)) {
    badge.textContent = `Opens in ${gap(Number(opens) - now)}`;
    badge.dataset.tone = "warn";
  } else {
    badge.textContent = `Open · ${gap(Number(closes) - now)} left`;
    badge.dataset.tone = "good";
    ready = true;
  }
  $("#window").replaceChildren(badge);
  state.ready = ready;
  return ready;
}

async function connect() {
  await new Promise(done => setTimeout(done, 250));
  const provider = wallet ?? window.ethereum;
  if (!provider) throw new Error("No wallet detected. Unlock the extension and reload.");

  const chain = await provider.request({ method: "eth_chainId" });
  if (String(chain).toLowerCase() !== CHAIN_HEX) {
    throw new Error(`Wallet is on chain ${parseInt(chain, 16)}. Switch to Robinhood Chain (${CHAIN_ID}).`);
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const account = String(accounts?.[0] ?? "").toLowerCase();
  if (account !== String(state.creator).toLowerCase()) {
    throw new Error(`Connect the creator account ${state.creator}. This wallet is ${account}.`);
  }
  return { provider, account };
}

async function start() {
  try {
    const ready = await refresh();
    const { account } = await connect();
    $("#send").disabled = !ready;
    setStatus(
      ready
        ? `Connected as ${account}. Read every field above, then check in.`
        : `Connected as ${account}. The button stays disabled until the window is open.`,
      ready ? "good" : "",
    );
  } catch (error) {
    setStatus(error.message, "bad");
  }
}

$("#send").addEventListener("click", async () => {
  $("#send").disabled = true;
  try {
    // Re-read immediately before prompting: the window can close between loading the page and
    // pressing the button, and a wallet can switch networks underneath it.
    if (!(await refresh())) throw new Error("The window is no longer open. Nothing was sent.");
    const { provider, account } = await connect();

    setStatus("Confirm in your wallet. Check the recipient, the zero value, and the data.", "warn");
    const hash = await provider.request({
      method: "eth_sendTransaction",
      params: [{ from: account, to: escrow, value: "0x0", data: SELECTORS["recordGm()"] }],
    });

    setStatus(`Submitted ${hash}. Waiting for the receipt…`, "warn");
    let receipt = null;
    for (let attempt = 0; attempt < 60 && !receipt; attempt += 1) {
      receipt = await rpc("eth_getTransactionReceipt", [hash]);
      if (!receipt) await new Promise(done => setTimeout(done, 2000));
    }
    if (!receipt) throw new Error(`No receipt yet for ${hash}. Check the explorer before retrying.`);
    if (BigInt(receipt.status) !== 1n) {
      throw new Error(`The transaction reverted. No check-in was recorded. Hash ${hash}`);
    }

    await refresh();
    setStatus(`Checked in. Tokens released, streak advanced. Hash ${hash}`, "good");
    $("#send").disabled = true;
  } catch (error) {
    setStatus(error.message, "bad");
    $("#send").disabled = !state.ready;
  }
});

start();
