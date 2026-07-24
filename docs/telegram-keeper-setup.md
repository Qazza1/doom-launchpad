# Telegram keeper setup

This is the solo-developer setup for DoomStreak Stage 3.3. The keeper sends
alerts only. It has no private key and cannot sign, pause, finalize, collect, or
move assets.

## 1. Create the bot

1. Open Telegram.
2. Search for the verified `@BotFather` account.
3. Send `/newbot`.
4. Choose a display name, for example `DoomStreak Keeper`.
5. Choose a unique username ending in `bot`, for example
   `DoomStreakKeeperBot`.
6. BotFather returns a token. Treat it like a password.
7. Open the bot using BotFather's link and press **Start**, or send `/start`.

Official references:

- <https://core.telegram.org/bots>
- <https://core.telegram.org/bots/api>

## 2. Create the local secret file

Open PowerShell in the repository:

```powershell
cd C:\Users\golis\Desktop\doomstreak-site\doom-launchpad
Copy-Item tools\keeper\.env.example tools\keeper\.env
notepad tools\keeper\.env
```

Replace only the token line initially:

```dotenv
TELEGRAM_BOT_TOKEN=the_token_from_botfather
TELEGRAM_CHAT_ID=replace_after_setup
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
ROBINHOOD_FALLBACK_RPC_URL=
```

Save and close Notepad. Do not paste the token into Codex, Discord, email,
GitHub, screenshots, or command-line arguments. `tools/keeper/.env` is ignored
by Git.

## 3. Discover the chat ID

Install the pinned package and run the helper:

```powershell
npm.cmd ci --prefix tools\keeper
npm.cmd run telegram:setup --prefix tools\keeper
```

The helper verifies the bot without printing its token and returns a line such
as:

```dotenv
TELEGRAM_CHAT_ID=123456789
```

Open the local file again and replace `replace_after_setup` with that number:

```powershell
notepad tools\keeper\.env
```

## 4. Send the test alert

Run the same command again:

```powershell
npm.cmd run telegram:setup --prefix tools\keeper
```

Telegram should receive **DoomStreak keeper connected**. This test does not
touch Robinhood Chain.

## Troubleshooting

- **No chat found:** open the bot, press **Start**, send `/start`, then rerun.
- **Unauthorized:** the token is wrong or was revoked. Generate a new token with
  BotFather and replace the local value.
- **Several chat IDs shown:** choose the private chat belonging to you.
- **Token exposed:** use BotFather to revoke it immediately, generate another,
  and replace the local value.

Before sharing `git status`, logs, or screenshots, verify that no token appears.
