// ---------------------------------------------------------------------------
// env.js — minimal .env loader (no dependency).
//
// Imported for its side effect FIRST in server.js so that config files are
// loaded before any other module reads process.env. Never overrides variables
// already present in the environment (so systemd / shell exports win).
//
// Search order (first existing file wins):
//   1. $CLAUDE_WATCH_ENV_FILE
//   2. ./bridge.env                    (cwd — e.g. systemd WorkingDirectory)
//   3. ~/.config/claude-watch/bridge.env
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseAndApply(content) {
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const candidates = [
  process.env.CLAUDE_WATCH_ENV_FILE,
  path.join(process.cwd(), "bridge.env"),
  path.join(os.homedir(), ".config", "claude-watch", "bridge.env"),
].filter(Boolean);

export let loadedEnvFile = null;
for (const file of candidates) {
  try {
    parseAndApply(fs.readFileSync(file, "utf-8"));
    loadedEnvFile = file;
    break;
  } catch { /* try next */ }
}
