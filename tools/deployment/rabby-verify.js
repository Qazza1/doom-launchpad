const status = document.querySelector("#status");
const button = document.querySelector("#verify");
let rabbyProvider;

function setStatus(message, type = "") {
  status.textContent = message;
  status.dataset.type = type;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

window.addEventListener("eip6963:announceProvider", event => {
  if (event.detail?.info?.rdns === "io.rabby") {
    rabbyProvider = event.detail.provider;
  }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function messageToHex(message) {
  return `0x${Array.from(new TextEncoder().encode(message), byte =>
    byte.toString(16).padStart(2, "0")).join("")}`;
}

async function getRabby() {
  await wait(250);
  if (rabbyProvider) return rabbyProvider;
  if (window.ethereum?.isRabby) return window.ethereum;
  throw new Error("Rabby was not detected. Install or unlock the official Rabby extension.");
}

async function ensureRobinhood(provider, chainId) {
  const expected = `0x${chainId.toString(16)}`;
  const current = await provider.request({ method: "eth_chainId" });
  if (current.toLowerCase() === expected) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expected }],
    });
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: expected,
        chainName: "Robinhood Chain Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
        blockExplorerUrls: ["https://explorer.mainnet.chain.robinhood.com"],
      }],
    });
  }
  const afterSwitch = await provider.request({ method: "eth_chainId" });
  if (afterSwitch.toLowerCase() !== expected) {
    throw new Error(`Rabby did not switch to Robinhood Chain (${chainId}).`);
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    setStatus("Detecting Rabby…");
    const challenge = await fetch("/challenge", { cache: "no-store" }).then(response => response.json());
    const provider = await getRabby();
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = accounts?.[0];
    if (!address || address.toLowerCase() !== challenge.expectedAddress.toLowerCase()) {
      throw new Error(`Wrong Rabby account. Select ${challenge.expectedAddress}.`);
    }

    setStatus("Address matched. Confirming Robinhood Chain…");
    await ensureRobinhood(provider, challenge.chainId);

    setStatus("Review and sign the non-transaction text message in Rabby…");
    const signature = await provider.request({
      method: "personal_sign",
      params: [messageToHex(challenge.message), address],
    });

    const response = await fetch("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address,
        message: challenge.message,
        signature,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Signature verification failed.");

    setStatus(result.message, "success");
    button.textContent = "VERIFIED";
  } catch (error) {
    setStatus(error?.message || "Verification failed.", "error");
    button.disabled = false;
  }
});
