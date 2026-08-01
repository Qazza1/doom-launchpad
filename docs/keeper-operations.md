# Keeper operations

The Stage 3.3 keeper is a read-only Robinhood Chain monitor with Telegram
delivery. It never loads a wallet key and deliberately has no transaction
broadcast path.

## Alert coverage

- wrong chain and stale RPC head;
- primary RPC failure with fallback activation;
- missing factory, permanent-locker, or reward-vault bytecode;
- factory, locker, and reward-vault immutable/configuration mismatch;
- unexpected factory pause state;
- live permanent-position ownership failure;
- upcoming GM check-in, open window, final warning, and missed deadline;
- permissionless default-finalization review;
- permissionless LP-fee collection review.

The tool advises a human to simulate and review permissionless actions. Delayed
keeper execution affects freshness only; it does not weaken escrow or lock
safety.

## Before enabling

`config/keeper.example.json` remains disabled and contains deployment
placeholders. After the tagged Stage 4 deployment:

1. copy it to a reviewed production manifest;
2. fill the deployed factory, liquidity manager, locker, rewards vault, and
   deployment block;
3. independently verify every address and immutable;
4. retain `expectedFactoryPaused: true` until the separate resume approval;
5. configure independent primary and fallback RPCs;
6. run a dry check before allowing Telegram state to persist.

Dry run:

```powershell
npm.cmd run monitor --prefix tools\keeper -- --config path\to\keeper.json --dry-run
```

Live read-only check:

```powershell
npm.cmd run monitor --prefix tools\keeper -- --config path\to\keeper.json
```

State is written under `tools/keeper/state/` to suppress duplicate messages.
The production scheduler must use persistent storage; deleting this state can
repeat active alerts. A one-minute schedule is appropriate for the 15-minute
critical GM lead, but the hosting/scheduler choice remains a Stage 4 operations
input.

## Railway worker

Use a separate Railway service sourced from this repository's `main` branch. It
must have one replica and a persistent volume mounted at `/data`.

- Dockerfile variable: `RAILWAY_DOCKERFILE_PATH=Dockerfile.keeper`
- Build command override: leave empty
- Start command override: leave empty
- Health path: `/health`
- Health timeout: `30`

Required variables are `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
`ROBINHOOD_RPC_URL`, and `ROBINHOOD_FALLBACK_RPC_URL`. Set
`KEEPER_INTERVAL_SECONDS=60`. Do not add a wallet seed, private key, deployer
credential, operator key, or guardian key.

## Failure handling

- A critical monitor failure must not trigger an automatic transaction.
- Never add a deployer, operator, guardian, creator, or campaign-manager key to
  the keeper environment.
- If Telegram delivery fails, the state file is not advanced, so the pending
  alert is retried on the next run.
- If the primary RPC fails and the fallback succeeds, the keeper sends a warning
  and continues using the complete fallback snapshot.
