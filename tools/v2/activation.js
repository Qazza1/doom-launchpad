const details = document.getElementById("details");
const button = document.getElementById("send");
const status = document.getElementById("status");
const title = document.getElementById("title");
const warning = document.getElementById("warning");
const intent = await fetch("/api/intent", { cache: "no-store" }).then(response => response.json());
const transaction = intent.transaction;
title.textContent = intent.presentation.title;
warning.textContent = intent.presentation.warning;
button.textContent = intent.presentation.button;
details.innerHTML = Object.entries({
  chainId: "4663 (Robinhood Chain mainnet)",
  from: transaction.from,
  to: transaction.to,
  value: "0 ETH",
  calldata: transaction.data,
  nonce: Number.parseInt(transaction.nonce, 16),
  gasLimit: Number.parseInt(transaction.gas, 16),
}).map(([label, value]) => `<div class="row"><div class="label">${label}</div>${value}</div>`).join("");
button.disabled = intent.status !== "authorized";

button.addEventListener("click", async () => {
  button.disabled = true;
  let transactionHash = null;
  try {
    if (!window.ethereum) throw new Error("Rabby-compatible wallet provider not found");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (accounts[0]?.toLowerCase() !== transaction.from.toLowerCase()) throw new Error("connected wallet is not the authorized operator");
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (Number.parseInt(chainId, 16) !== 4663) throw new Error("wallet is not on Robinhood Chain mainnet (4663)");
    status.textContent = "Review Rabby carefully. Sign only if every displayed field matches this page.";
    status.className = "";
    transactionHash = await window.ethereum.request({ method: "eth_sendTransaction", params: [transaction] });
    status.textContent = `Submitted ${transactionHash}. Verifying through both RPC providers…`;
    const verification = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transactionHash }),
    }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "verification failed");
      return body;
    });
    status.textContent = `VERIFIED SUCCESS — ${verification.transactionHash}. Return to Codex before any next step.`;
    status.className = "ok";
  } catch (error) {
    status.textContent = transactionHash
      ? `Submitted ${transactionHash}, but automatic verification did not finish: ${error.message}. Return to Codex; do not click again.`
      : error.message;
    status.className = "error";
    button.disabled = transactionHash !== null;
  }
});
