const status = document.querySelector("#status");
const details = document.querySelector("#details");
const connect = document.querySelector("#connect");
const sign = document.querySelector("#sign");
let walletProvider;
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
  if (!walletProvider) walletProvider = event.detail?.provider;
  if (event.detail?.info?.rdns === "io.rabby") walletProvider = event.detail.provider;
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

async function getWallet() {
  await wait(250);
  if (walletProvider) return walletProvider;
  if (window.ethereum) return window.ethereum;
  throw new Error("No wallet was detected. Unlock the extension and reload this page.");
}

/// Two independent guards, run in the page before any prompt and again on the server before the
/// result is accepted. The wallet must be on the isolated preview chain, and the creator account
/// must hold the local-only sentinel balance. Neither substitutes for the other.
async function assertPreviewChain(provider) {
  const expected = `0x${plan.previewChainId.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() !== expected) {
    throw new Error(
      `The wallet is on chain ${parseInt(current, 16)}. Switch to the preview network ` +
        `(${plan.previewChainId}) pointed at ${plan.previewRpcUrl}. This tool refuses to run on ` +
        "Robinhood mainnet, where a signature would be a real transaction.",
    );
  }
  const balance = await provider.request({
    method: "eth_getBalance",
    params: [plan.sender, "latest"],
  });
  // A window, not equality: signing spends gas, and an exact check would fail on a reload.
  if (
    BigInt(balance) > BigInt(plan.sentinelBalanceWei) ||
    BigInt(balance) < BigInt(plan.minimumPreviewBalanceWei)
  ) {
    throw new Error(
      "The connected network does not carry the local sentinel balance. This is not the preview fork.",
    );
  }
}

function weiToEth(value) {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function render() {
  const transaction = plan.transaction;
  const rows = [
    ["Plan", `${plan.kind} · ${plan.planHash}`],
    ["Calldata hash", plan.calldataHash],
    ["From", transaction.from],
    ["To", transaction.to],
    ["Value", `${weiToEth(transaction.value)} ETH (${BigInt(transaction.value)} wei)`],
    ["Calldata", `${(transaction.data.length - 2) / 2} bytes`],
    ["Preview nonce", `${transaction.nonce} (production plan uses ${plan.productionNonce})`],
  ];
  if (plan.tokenName) rows.splice(2, 0, ["Token", `${plan.tokenName} (${plan.tokenSymbol})`]);

  details.replaceChildren();
  for (const [term, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    details.append(dt, dd);
  }
  details.hidden = false;
  sign.hidden = false;
}

connect.addEventListener("click", async () => {
  connect.disabled = true;
  try {
    setStatus("Loading the prepared plan…");
    plan = await (await fetch("/plan")).json();
    const provider = await getWallet();
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    account = accounts?.[0];
    if (String(account).toLowerCase() !== String(plan.sender).toLowerCase()) {
      throw new Error(`Connect ${plan.sender}. The wallet offered ${account}.`);
    }
    await assertPreviewChain(provider);
    render();
    setStatus("Guards passed. Read every field above, then sign.", "success");
  } catch (error) {
    setStatus(error.message, "error");
    connect.disabled = false;
  }
});

sign.addEventListener("click", async () => {
  sign.disabled = true;
  try {
    const provider = await getWallet();
    // Guards again, immediately before the prompt. The wallet can change networks between the
    // click that loaded the plan and the click that signs it.
    await assertPreviewChain(provider);
    setStatus("Confirm in the wallet. Compare the recipient, value, and data first.", "notice");

    const transaction = plan.transaction;
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [{
        from: transaction.from,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
        nonce: `0x${transaction.nonce.toString(16)}`,
      }],
    });

    setStatus("Signed. Reading the mined transaction back from the fork…", "notice");
    const response = await fetch("/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash }),
    });
    const body = await response.json();
    if (!body.ok) throw new Error(body.error);

    setStatus(
      `The wallet signed exactly the planned call. Gas ${body.compared.gasUsed}. ` +
        "Report written. This authorizes nothing.",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error");
    sign.disabled = false;
  }
});
