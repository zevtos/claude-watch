// ---------------------------------------------------------------------------
// telegram.js — push pairing codes (and bridge events) to a Telegram chat.
//
// Config (env vars — see bridge.env.example):
//   TELEGRAM_BOT_TOKEN   bot token from @BotFather
//   TELEGRAM_CHAT_ID     your numeric user id (from @userinfobot) or chat id
//
// No-op when unset, so the bridge runs fine without Telegram configured.
// Uses Node's global fetch (Node 18+) — no dependency.
// ---------------------------------------------------------------------------

function cfg() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || process.env.CLAUDE_WATCH_TELEGRAM_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || process.env.CLAUDE_WATCH_TELEGRAM_CHAT_ID || "",
  };
}

export function telegramEnabled() {
  const { token, chatId } = cfg();
  return Boolean(token && chatId);
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Fire-and-forget message. Resolves true on success, false otherwise.
 * @param {string} text  HTML-formatted message
 * @param {(level:string,msg:string)=>void} [log]
 */
export async function sendTelegram(text, log = () => {}) {
  const { token, chatId } = cfg();
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log("warn", `Telegram sendMessage failed (${res.status}): ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    log("warn", `Telegram request error: ${err.message}`);
    return false;
  }
}

/**
 * Format + send a pairing-code notification.
 * @param {string} code
 * @param {{host?:string, port?:(number|string), publicUrl?:string, ttlMinutes?:number}} meta
 * @param {Function} [log]
 */
export function sendPairingCode(code, meta = {}, log) {
  const lines = [
    "🔑 <b>Agent Watch — pairing code</b>",
    `Code: <code>${escapeHtml(code)}</code>`,
  ];
  if (meta.publicUrl) lines.push(`URL: <code>${escapeHtml(meta.publicUrl)}</code>`);
  else if (meta.host) lines.push(`Host: <code>${escapeHtml(meta.host)}${meta.port ? ":" + meta.port : ""}</code>`);
  lines.push(`Valid for ${meta.ttlMinutes ?? 5} min.`);
  return sendTelegram(lines.join("\n"), log);
}
