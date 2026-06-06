#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Agent Watch — cross-platform hook installer (macOS / Linux / Windows).
//
// Writes the bridge's HTTP hooks into ~/.claude/settings.json for ALL Claude
// Code sessions. Pure Node — no bash or python3 required.
//
// Usage:
//   node setup-hooks.mjs [port]      install (default port 7860)
//   node setup-hooks.mjs --remove    remove Agent Watch hooks
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

const isWatchHookEntry = (entry) =>
  (entry?.hooks || []).some(
    (h) =>
      typeof h.url === "string" &&
      h.url.startsWith("http://127.0.0.1:") &&
      h.url.includes("/hooks/"),
  );

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf-8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + "\n");
}

function remove() {
  if (!fs.existsSync(SETTINGS)) {
    console.log(`No settings file found at ${SETTINGS}`);
    return;
  }
  const settings = readSettings();
  const hooks = settings.hooks || {};
  let changed = false;

  for (const event of Object.keys(hooks)) {
    const filtered = hooks[event].filter((e) => !isWatchHookEntry(e));
    if (filtered.length !== hooks[event].length) {
      changed = true;
      if (filtered.length) hooks[event] = filtered;
      else delete hooks[event];
    }
  }

  if (changed) {
    if (Object.keys(hooks).length === 0) delete settings.hooks;
    else settings.hooks = hooks;
    writeSettings(settings);
    console.log(`Agent Watch hooks removed from ${SETTINGS}`);
  } else {
    console.log("No Agent Watch hooks found.");
  }
}

function install(port) {
  const BRIDGE = `http://127.0.0.1:${port}`;
  const http = (url, timeout) => ({ hooks: [{ type: "http", url: `${BRIDGE}${url}`, timeout }] });

  const newHooks = {
    PostToolUse: [http("/hooks/tool-output", 5)],
    PreToolUse: [http("/hooks/tool-output", 5)],
    PermissionRequest: [http("/hooks/permission", 600)],
    Stop: [http("/hooks/stop", 5)],
    PostToolUseFailure: [http("/hooks/error", 5)],
    StopFailure: [http("/hooks/error", 5)],
    Notification: [{ matcher: "idle_prompt|permission_prompt", ...http("/hooks/stop", 5) }],
  };

  const settings = readSettings();
  const hooks = settings.hooks || {};

  for (const [event, entries] of Object.entries(newHooks)) {
    const existing = (hooks[event] || []).filter((e) => !isWatchHookEntry(e));
    hooks[event] = [...existing, ...entries];
  }

  settings.hooks = hooks;
  writeSettings(settings);

  console.log("Installing Agent Watch hooks...");
  console.log(`  Bridge URL: ${BRIDGE}`);
  console.log(`  Settings:   ${SETTINGS}`);
  console.log("\nHooks installed successfully! Events hooked:");
  for (const event of Object.keys(newHooks)) console.log(`  • ${event}`);
  console.log("\nNote: Codex wrapper (codex-watch) is POSIX-only — use setup-hooks.sh on macOS/Linux for Codex.");
}

const arg = process.argv[2];
if (arg === "--remove") remove();
else install(parseInt(arg, 10) || 7860);
