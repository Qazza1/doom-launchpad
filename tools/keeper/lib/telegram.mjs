const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]{20,}$/;
const CHAT_ID = /^-?\d+$/;

export function validateBotToken(value) {
  if (value === "replace_with_botfather_token") {
    throw new Error("TELEGRAM_BOT_TOKEN is still the placeholder; replace it with the token from @BotFather");
  }
  if (!BOT_TOKEN.test(value)) throw new Error("TELEGRAM_BOT_TOKEN has an unexpected format");
  return value;
}

export function validateChatId(value) {
  if (!CHAT_ID.test(value)) throw new Error("TELEGRAM_CHAT_ID must be an integer");
  return value;
}

export async function telegramRequest(tokenInput, method, body = {}, fetchImpl = fetch) {
  const token = validateBotToken(tokenInput);
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const cause = error && typeof error === "object" ? error.cause : null;
    const code = cause && typeof cause === "object" && typeof cause.code === "string"
      ? ` [${cause.code}]`
      : "";
    const causeMessage = cause instanceof Error && cause.message !== error?.message
      ? `: ${cause.message}`
      : "";
    throw new Error(
      `Telegram ${method} request failed: ${error instanceof Error ? error.message : "network error"}${code}${causeMessage}`,
      { cause: error },
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Telegram ${method} returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? `HTTP ${response.status}`}`);
  }
  return payload.result;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function formatTelegramAlert(alert, observedAt) {
  const icon = alert.severity === "critical" ? "🚨" : alert.severity === "warning" ? "⚠️" : "ℹ️";
  const lines = [
    `${icon} <b>${escapeHtml(alert.title)}</b>`,
    `<code>${escapeHtml(alert.id)}</code>`,
    "",
    escapeHtml(alert.summary),
  ];
  if (Array.isArray(alert.details)) {
    for (const detail of alert.details) lines.push(`• ${escapeHtml(detail)}`);
  }
  if (alert.action) lines.push("", `<b>Action:</b> ${escapeHtml(alert.action)}`);
  lines.push("", `<i>Observed ${escapeHtml(new Date(observedAt * 1000).toISOString())}</i>`);
  return lines.join("\n");
}

export async function sendTelegramAlert({ token, chatId, alert, observedAt, fetchImpl = fetch }) {
  return telegramRequest(
    token,
    "sendMessage",
    {
      chat_id: validateChatId(chatId),
      text: formatTelegramAlert(alert, observedAt),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    },
    fetchImpl,
  );
}
