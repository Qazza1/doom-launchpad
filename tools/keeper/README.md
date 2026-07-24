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
