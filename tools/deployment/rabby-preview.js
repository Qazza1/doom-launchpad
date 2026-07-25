const status = document.querySelector("#status");
const steps = document.querySelector("#steps");
const connect = document.querySelector("#connect");
let rabbyProvider;
let plan;
let account;

function setStatus(message, type = "") {
  status.textContent = message;
  status.dataset.type = type;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

window.addEventListener("eip6963:announceProvider", event => {
  if (event.detail?.info?.rdns === "io.rabby") rabbyProvider = event.detail.provider;
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

async function getRabby() {
  await wait(250);
  if (rabbyProvider) return rabbyProvider;
  if (window.ethereum?.isRabby) return window.ethereum;
  throw new Error("Rabby was not detected. Install or unlock the official Rabby extension.");
}

/// Two independent guards run before any signing prompt and again before every step: the wallet must
/// be on the isolated preview chain, and the deployer must hold the local-only sentinel balance.
async function assertPreviewChain(provider) {
  const expected = `0x${plan.previewChainId.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (current.toLowerCase() !== expected) {
    throw new Error(
      `Rabby is on chain ${parseInt(current, 16)}. Switch to the preview network (${plan.previewChainId}) ` +
        `pointed at ${plan.previewRpcUrl}. This tool refuses to run on Robinhood mainnet.`,
    );
  }
  const balance = await provider.request({
    method: "eth_getBalance",
    params: [plan.deployer, "latest"],
  });
  // A window, not equality: each confirmed step spends gas, and an exact check would reject every
  // step after the first and make a page reload look like the wrong network.
  if (
    BigInt(balance) > BigInt(plan.sentinelBalanceWei) ||
    BigInt(balance) < BigInt(plan.minimumPreviewBalanceWei)
  ) {
    throw new Error(
      "The connected network does not carry the local sentinel balance. This is not the preview fork.",
    );
  }
}

function describe(transaction) {
  const target = transaction.to
    ? `to ${transaction.to}`
    : `creates ${transaction.predictedAddress}`;
  const bytes = (transaction.data.length - 2) / 2;
  return `nonce ${transaction.nonce} · ${target} · ${bytes} bytes · sha256 ${transaction.dataSha256.slice(0, 16)}`;
}

function renderSteps() {
  steps.replaceChildren();
  for (const transaction of plan.transactions) {
    const item = document.createElement("li");
    const heading = document.createElement("h3");
    heading.textContent = transaction.irreversible
      ? `${transaction.label} — IRREVERSIBLE`
      : transaction.label;
    const detail = document.createElement("p");
    detail.textContent = describe(transaction);
    const button = document.createElement("button");
    const confirmed = plan.completed.includes(transaction.order);
    button.textContent = confirmed ? "CONFIRMED" : `Send step ${transaction.order + 1} in Rabby`;
    button.disabled = confirmed || transaction.order !== plan.completed.length;
    button.addEventListener("click", () => submit(transaction, button, detail));
    item.append(heading, detail, button);
    steps.append(item);
  }
}

const submitted = new Map();

async function submit(transaction, button, detail) {
  button.disabled = true;
  try {
    const provider = await getRabby();
    await assertPreviewChain(provider);

    const request = {
      from: transaction.from,
      value: transaction.value,
      nonce: `0x${transaction.nonce.toString(16)}`,
      data: transaction.data,
    };
    if (transaction.to) request.to = transaction.to;

    // A step that was signed but failed verification must never be signed again: the nonce is
    // already spent, so a retry re-checks the existing hash instead of sending a second transaction.
    let txHash = submitted.get(transaction.order);
    if (txHash) {
      setStatus(`Re-checking the step ${transaction.order + 1} transaction already signed…`);
    } else {
      setStatus(`Review step ${transaction.order + 1} in Rabby, then confirm…`);
      txHash = await provider.request({ method: "eth_sendTransaction", params: [request] });
      submitted.set(transaction.order, txHash);
    }

    setStatus("Waiting for the preview receipt…");
    const response = await fetch("/step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order: transaction.order, txHash, transaction: request }),
    });
    const result = await response.json();

    // A realignment renumbers every later nonce and changes every predicted address, so the page
    // must reload the new plan rather than keep showing the one it just invalidated. The signed
    // transaction was dropped, so the stored hash must go too or the retry would re-check a
    // transaction that no longer exists.
    if (result.realigned) {
      submitted.delete(transaction.order);
      plan = await fetch("/plan", { cache: "no-store" }).then(response => response.json());
      renderSteps();
      // Not an error: this is the designed path when the wallet's cached nonce is ahead. Showing it
      // in the failure colour would teach the operator to discount the status line.
      setStatus(result.error, "notice");
      return;
    }
    if (!response.ok || !result.ok) throw new Error(result.error || "step verification failed");

    plan.completed.push(transaction.order);
    detail.textContent = `${detail.textContent} · gas ${result.gasUsed}`;
    button.textContent = "CONFIRMED";
    const next = steps.querySelectorAll("button")[transaction.order + 1];
    if (next) next.disabled = false;

    if (result.remaining === 0) {
      const finish = await fetch("/finish", { method: "POST", headers: { "content-type": "application/json" } });
      const report = await finish.json();
      if (!finish.ok || !report.ok) throw new Error(report.error || "finalisation failed");
      setStatus(
        `All six steps confirmed. Factory paused: ${report.postconditions.factoryPaused}. ` +
          "Signatures are bound to the preview chain and cannot be replayed on mainnet.",
        "success",
      );
    } else {
      setStatus(`Step ${transaction.order + 1} verified. ${result.remaining} remaining.`);
    }
  } catch (error) {
    const retry = submitted.has(transaction.order)
      ? " The transaction was already signed; pressing the button again re-checks it instead of resending."
      : "";
    setStatus(`${error?.message || "step failed"}${retry}`, "error");
    button.disabled = false;
  }
}

connect.addEventListener("click", async () => {
  connect.disabled = true;
  try {
    setStatus("Loading the planned transactions…");
    plan = await fetch("/plan", { cache: "no-store" }).then(response => response.json());

    const provider = await getRabby();
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    account = accounts?.[0];
    if (!account || account.toLowerCase() !== plan.deployer.toLowerCase()) {
      throw new Error(`Wrong Rabby account. Select ${plan.deployer}.`);
    }
    await assertPreviewChain(provider);

    renderSteps();
    setStatus(
      `Connected on preview chain ${plan.previewChainId} at nonce ${plan.startingNonce}. ` +
        "Send one step at a time and read each Rabby prompt before confirming.",
      "success",
    );
    connect.textContent = "CONNECTED";
  } catch (error) {
    setStatus(error?.message || "connection failed", "error");
    connect.disabled = false;
  }
});
