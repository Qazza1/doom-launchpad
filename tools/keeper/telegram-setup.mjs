import { loadKeeperEnv, requireEnvironment } from "./lib/env.mjs";
import { sendTelegramAlert, telegramRequest, validateChatId } from "./lib/telegram.mjs";

loadKeeperEnv();
const token = requireEnvironment("TELEGRAM_BOT_TOKEN");
const bot = await telegramRequest(token, "getMe");
console.log(`Connected to @${bot.username}. The token was not printed.`);

const configuredChatId = process.env.TELEGRAM_CHAT_ID?.trim();
if (configuredChatId && !configuredChatId.startsWith("replace_")) {
  const chatId = validateChatId(configuredChatId);
  await sendTelegramAlert({
    token,
    chatId,
    observedAt: Math.floor(Date.now() / 1000),
    alert: {
      id: "setup:test",
      severity: "info",
      title: "DoomStreak keeper connected",
      summary: "Telegram delivery works. Monitoring remains read-only and deployment is still disabled.",
      details: ["No transaction was signed or broadcast."],
    },
  });
  console.log(`Test alert sent to chat ${chatId}.`);
  process.exit(0);
}

const updates = await telegramRequest(token, "getUpdates", { limit: 100, timeout: 0 });
const chats = new Map();
for (const update of updates) {
  const message = update.message ?? update.channel_post ?? update.edited_message;
  if (message?.chat?.id !== undefined) {
    chats.set(String(message.chat.id), message.chat);
  }
}

if (chats.size === 0) {
  throw new Error("No chat found. Open your bot in Telegram, press Start, send /start, then run this command again.");
}
if (chats.size > 1) {
  console.log("More than one chat contacted this bot. Choose the intended private chat:");
  for (const [id, chat] of chats) {
    console.log(`TELEGRAM_CHAT_ID=${id}  (${chat.type}: ${chat.username ?? chat.title ?? chat.first_name ?? "unnamed"})`);
  }
  process.exit(1);
}

const [[chatId, chat]] = chats;
console.log(`Found ${chat.type} chat: ${chat.username ?? chat.first_name ?? chat.title ?? "unnamed"}`);
console.log(`Add this line to tools/keeper/.env:\nTELEGRAM_CHAT_ID=${chatId}`);
console.log("Then run this command once more to send the test alert.");
