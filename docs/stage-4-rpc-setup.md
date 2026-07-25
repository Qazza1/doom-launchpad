# Stage 4 RPC setup

Use two independent production providers:

- Primary: Alchemy Robinhood Mainnet.
- Fallback: QuickNode Robinhood Mainnet.

The Robinhood public RPC is suitable for testing but is rate-limited and is not
the production endpoint for deployment, verification, keeper, or indexer use.

## 1. Create the Alchemy primary endpoint

1. Sign in at `https://dashboard.alchemy.com/`.
2. Create a new app.
3. Select **Robinhood** and **Mainnet**.
4. Open the app's API-key/endpoints page.
5. Copy the HTTPS endpoint. Its format is:
   `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}`.
6. Do not paste the URL into source control, GitHub, Telegram, or chat.

## 2. Create the QuickNode fallback endpoint

1. Sign in at `https://dashboard.quicknode.com/`.
2. Create an endpoint for **Robinhood Mainnet**.
3. Copy the HTTPS endpoint. Its format is:
   `https://{ENDPOINT}.robinhood-mainnet.quiknode.pro/{TOKEN}`.
4. Do not enable transaction allowlists yet.
5. Do not paste the URL into source control, GitHub, Telegram, or chat.

## 3. Run the secret-safe preflight

From PowerShell:

```powershell
cd C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
powershell -ExecutionPolicy Bypass -File .\tools\deployment\rpc-preflight.ps1
```

The prompts hide both URLs. The script checks:

- HTTPS and independent provider hosts;
- chain ID 4663;
- current and historical block access;
- deployer pending nonce and balance agreement;
- NFT, WETH, V3 factory, and position-manager bytecode agreement;
- provider head distance;
- request latency.

It never calls `eth_sendRawTransaction`, never loads a wallet, never writes the
URLs to disk, and removes them from its environment before exiting.

Save the JSON result without the URLs if needed. A successful result authorizes
only the next non-broadcast rehearsal, not deployment.

Owner-reported status on 2026-07-25: passed. Continue with
`docs/stage-4-wallet-and-rehearsal.md`.
