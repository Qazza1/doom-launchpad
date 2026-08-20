const details = document.querySelector("#details");
const confirmation = document.querySelector("#confirmation");
const submit = document.querySelector("#submit");
const statusLine = document.querySelector("#status");
let locked;
let submittedHash;

const short = value => value ? `${value.slice(0, 10)}…${value.slice(-8)}` : "contract creation";
const setStatus = (message, kind = "muted") => {
  statusLine.className = kind;
  statusLine.textContent = message;
};

async function getDoomRabbyProvider() {
  if (window.ethereum?.isRabby) return window.ethereum;
  throw new Error("Rabby was not detected. Unlock the official Rabby browser extension.");
}

async function assertWallet(provider) {
  const chainHex = await provider.request({ method: "eth_chainId" });
  const chainId = Number.parseInt(chainHex, 16);
  if (chainId !== locked.chainId) {
    throw new Error(`Rabby is on chain ${chainId}; switch to Robinhood Mainnet ${locked.chainId}.`);
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (accounts[0]?.toLowerCase() !== locked.deployer.toLowerCase()) {
    throw new Error(`Wrong Rabby account. Select ${locked.deployer}.`);
  }
}

function render() {
  const tx = locked.transaction;
  const deploymentLabel = locked.deploymentLabel || "V2";
  const phrase = `SEND ${deploymentLabel.toUpperCase()} STEP ${locked.step + 1} ${locked.planSha256.slice(0, 12)}`;
  details.innerHTML = `
    <h2>${deploymentLabel} step ${locked.step + 1} of ${locked.totalSteps} — ${tx.label}</h2>
    <p><strong>Plan:</strong> <code>${locked.planSha256}</code></p>
    <p><strong>From:</strong> <code>${tx.from}</code></p>
    <p><strong>To:</strong> <code>${tx.to || "CONTRACT CREATION"}</code></p>
    <p><strong>Nonce:</strong> ${tx.nonce} · <strong>Value:</strong> 0 ETH</p>
    ${tx.predictedAddress ? `<p><strong>Predicted contract:</strong> <code>${tx.predictedAddress}</code></p>` : ""}
    <p><strong>Calldata SHA-256:</strong> <code>${tx.dataSha256}</code></p>
    <p><strong>Locked gas limit:</strong> <code>${locked.walletFeePolicy.gasLimit}</code></p>
    <p><strong>Locked max fee per gas:</strong> <code>${locked.walletFeePolicy.maxFeePerGasWei} wei</code></p>
    <p><strong>Maximum network fee:</strong> <code>${locked.walletFeePolicy.maximumNetworkFeeWei} wei</code></p>
    <p><strong>Safety:</strong> factory remains paused; no token launch is authorized.</p>
    <p><strong>Required confirmation:</strong> <code>${phrase}</code></p>
    <details><summary>Raw transaction data</summary><pre>${tx.data}</pre></details>`;
  confirmation.dataset.phrase = phrase;
  submit.textContent = `Send only ${deploymentLabel} step ${locked.step + 1} in Rabby`;
  confirmation.oninput = () => {
    submit.disabled = confirmation.value !== phrase || Boolean(submittedHash);
  };
  submit.disabled = true;
}

async function waitForNextSessionStep(previousStep) {
  confirmation.value = "";
  confirmation.disabled = true;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await fetch("/plan", { cache: "no-store" });
      if (!response.ok) continue;
      const next = await response.json();
      if (next.step <= previousStep) continue;
      locked = next;
      submittedHash = null;
      confirmation.disabled = false;
      render();
      setStatus(`Step ${locked.step + 1} is independently preflighted and ready. Review it before signing.`);
      return;
    } catch {
      // The local supervisor is replacing the verified step server.
    }
  }
  throw new Error("The next guarded step did not become ready. The verified receipt is saved; restart the session command.");
}

async function submitStep() {
  submit.disabled = true;
  try {
    const provider = await getDoomRabbyProvider();
    await assertWallet(provider);
    const tx = locked.transaction;
    const request = {
      from: tx.from,
      value: tx.value,
      nonce: `0x${tx.nonce.toString(16)}`,
      data: tx.data,
      gas: `0x${BigInt(locked.walletFeePolicy.gasLimit).toString(16)}`,
      maxFeePerGas: `0x${BigInt(locked.walletFeePolicy.maxFeePerGasWei).toString(16)}`,
      maxPriorityFeePerGas: `0x${BigInt(locked.walletFeePolicy.maxPriorityFeePerGasWei).toString(16)}`,
    };
    if (tx.to) request.to = tx.to;
    setStatus(`Review MAINNET ${locked.deploymentLabel || "V2"} step ${locked.step + 1} in Rabby. Confirm zero value and nonce ${tx.nonce}.`);
    submittedHash = await provider.request({ method: "eth_sendTransaction", params: [request] });
    setStatus(`Submitted ${short(submittedHash)}. Waiting for both providers and receipt verification…`);
    const response = await fetch("/submitted", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step: locked.step, txHash: submittedHash }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "receipt verification failed");
    if (locked.sessionMode && result.remaining > 0) {
      setStatus(`VERIFIED SUCCESS — ${result.record.transactionHash}. Preparing the next independently checked step…`, "ok");
      submit.textContent = "VERIFIED";
      await waitForNextSessionStep(locked.step);
    } else {
      setStatus(
        `VERIFIED SUCCESS — ${result.record.transactionHash}. ${result.remaining === 0 ? "All deployment steps are complete; the factory remains paused." : "Stop here and return to Codex before the next step."}`,
        "ok",
      );
      confirmation.disabled = true;
      submit.textContent = "VERIFIED — STOP";
    }
  } catch (error) {
    setStatus(error.message || String(error), "error");
    if (!submittedHash) submit.disabled = confirmation.value !== confirmation.dataset.phrase;
  }
}

submit.addEventListener("click", submitStep);

fetch("/plan", { cache: "no-store" })
  .then(response => response.json())
  .then(value => {
    locked = value;
    render();
    setStatus(`Locked ${locked.deploymentLabel || "V2"} plan loaded. Connect only the approved Rabby deployer on chain 4663.`);
  })
  .catch(error => setStatus(error.message || String(error), "error"));
