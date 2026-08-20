# DoomStreak keeper monitor

Read-only Robinhood Chain monitoring with Telegram alerts. The keeper does not
load a wallet key or broadcast transactions.

## Local checks

```bash
npm ci --prefix tools/keeper
npm test --prefix tools/keeper
```

## Telegram

Follow `docs/telegram-keeper-setup.md`. The setup helper verifies the BotFather
token, discovers the private chat after `/start`, and sends a harmless test
message.

## Monitoring

`config/keeper.example.json` is disabled and intentionally contains
placeholders. Do not enable it until Stage 4 provides verified deployed
addresses and a deployment block.

```bash
npm run monitor --prefix tools/keeper -- \
  --config path/to/keeper.json \
  --dry-run
```

See `docs/keeper-operations.md` for the alert rules and failure boundaries.

## Production daemon

The production runner repeats the same read-only monitor and exposes a
secret-free `GET /health` endpoint. Its alert state must live on persistent
storage so restarts do not resend every active alert.

```bash
npm run daemon --prefix tools/keeper -- \
  --config config/keeper-v2.mainnet.json \
  --state /data/keeper-v2-alerts.json
```

Set `KEEPER_INTERVAL_SECONDS=60` and mount the Railway volume at `/data`.
The repository includes `Dockerfile.keeper`; set Railway's
`RAILWAY_DOCKERFILE_PATH` variable to that filename.
The image defaults to the fail-closed paused policy through
`KEEPER_CONFIG_PATH=config/keeper-v2.mainnet.json`. Only when the factory is
separately authorized to resume, change it to
`config/keeper-v2-live.mainnet.json`; the live policy then raises a critical
alert if the factory becomes paused unexpectedly. `KEEPER_STATE_PATH` defaults
to `/data/keeper-v2-alerts.json`.
Set `KEEPER_STARTUP_NOTIFY=1` for one persistent-volume-deduplicated Telegram
message proving that the production host can reach the bot.

`KEEPER_SECONDARY_CONFIG_PATH` and `KEEPER_TERTIARY_CONFIG_PATH` may point to
the capped-public and permanent full-scale configuration files. The daemon
runs all three read-only checks sequentially and exposes every monitored
factory in `/health`; no signer or transaction path is added.

For the permanent generation, the preferred production setup is to set
`DOOM_FULLSCALE_V3_ENABLED=1` together with `DOOM_FULLSCALE_V3_FACTORY`,
`DOOM_FULLSCALE_V3_FACTORY_DEPLOYMENT_BLOCK`, `DOOM_FULLSCALE_V3_POSITION_LOCKER`,
`DOOM_FULLSCALE_V3_GRADUATION_MANAGER`, and `DOOM_FULLSCALE_V3_CURVE_DEPLOYER`.
The daemon builds the third read-only configuration at startup. Installing the
final deployment addresses therefore requires Railway variables only, not a
source change or another contract deployment.
