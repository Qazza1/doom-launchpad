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
  --config config/keeper.mainnet.json \
  --state /data/keeper-alerts.json
```

Set `KEEPER_INTERVAL_SECONDS=60` and mount the Railway volume at `/data`.
The repository includes `Dockerfile.keeper`; set Railway's
`RAILWAY_DOCKERFILE_PATH` variable to that filename.
Set `KEEPER_STARTUP_NOTIFY=1` for one persistent-volume-deduplicated Telegram
message proving that the production host can reach the bot.
