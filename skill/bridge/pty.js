// ---------------------------------------------------------------------------
// pty.js — cross-platform pseudo-terminal abstraction
//
// Spawns an interactive child (claude / codex TUI) attached to a PTY and exposes
// a normalized handle so server.js never touches OS-specific plumbing.
//
// Backend selection (best → degraded):
//   1. node-pty       — optional native dep; works on macOS, Linux, Windows
//                       (ConPTY), supports resize. Preferred when installed.
//   2. script (BSD)   — macOS / *BSD:  `script -q /dev/null cmd args...`
//   3. script (linux) — util-linux:    `script -qfc "cmd args" /dev/null`
//   4. pipe           — last resort (Windows w/o node-pty): plain pipes, no PTY.
//
// Normalized handle:
//   { pid, backend, write(data), resize(cols,rows), kill(sig?),
//     onData(cb: (string)=>void), onExit(cb: ({exitCode,signal,error})=>void) }
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { spawn as childSpawn } from "node:child_process";
import { createRequire } from "node:module";
import { IS_WIN, IS_MAC, winQuote, shQuote } from "./platform.js";

const require = createRequire(import.meta.url);

// node-pty ships a `spawn-helper` binary that npm/prebuild-install sometimes
// extracts WITHOUT the executable bit, making every fork fail with
// "posix_spawnp failed". Self-heal it so the optional dep works after a plain
// `npm install` on macOS/Linux.
function ensureSpawnHelperExecutable() {
  if (IS_WIN) return;
  try {
    const prebuilds = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
    for (const dir of fs.readdirSync(prebuilds)) {
      const helper = path.join(prebuilds, dir, "spawn-helper");
      try { fs.accessSync(helper, fs.constants.X_OK); }
      catch { try { fs.chmodSync(helper, 0o755); } catch { /* ignore */ } }
    }
  } catch { /* node-pty absent or layout changed — ignore */ }
}

// Optional native dependency — load synchronously, tolerate absence.
let nodePty = null;
try {
  nodePty = require("node-pty");
  ensureSpawnHelperExecutable();
} catch { /* not installed / failed to build — fall back to `script` */ }

export const PTY_BACKEND = nodePty
  ? "node-pty"
  : IS_WIN
    ? "pipe"
    : IS_MAC
      ? "script-bsd"
      : "script-linux";

/** True when sessions get a real PTY (TUIs render correctly). */
export const HAS_REAL_PTY = nodePty != null || !IS_WIN;

/**
 * Spawn an interactive child in a PTY.
 *
 * @param {string} bin   resolved executable path
 * @param {string[]} args
 * @param {{cwd?:string, env?:object, cols?:number, rows?:number}} opts
 * @returns {object} normalized PTY handle
 */
export function spawnPty(bin, args = [], opts = {}) {
  const { cwd, env, cols = 120, rows = 40 } = opts;
  const fullEnv = {
    ...process.env,
    TERM: "xterm-256color",
    ...(env || {}),
    COLUMNS: String(cols),
    LINES: String(rows),
  };

  if (nodePty) {
    const p = nodePty.spawn(bin, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env: fullEnv,
    });
    return {
      pid: p.pid,
      backend: "node-pty",
      write: (d) => { try { p.write(d); } catch { /* ignore */ } },
      resize: (c, r) => { try { p.resize(c, r); } catch { /* ignore */ } },
      kill: (sig) => { try { p.kill(sig); } catch { /* ignore */ } },
      onData: (cb) => p.onData(cb),
      onExit: (cb) => p.onExit(({ exitCode, signal }) => cb({ exitCode, signal })),
    };
  }

  // --- child_process fallbacks -------------------------------------------
  let child;
  if (!IS_WIN && IS_MAC) {
    // BSD `script`: command + args follow the typescript file path.
    child = childSpawn("script", ["-q", "/dev/null", bin, ...args], {
      cwd, env: fullEnv, stdio: ["pipe", "pipe", "pipe"],
    });
  } else if (!IS_WIN) {
    // util-linux `script`: command is a single -c string; -f flushes for streaming.
    const line = [bin, ...args].map(shQuote).join(" ");
    child = childSpawn("script", ["-qfc", line, "/dev/null"], {
      cwd, env: fullEnv, stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    // Windows without node-pty — degraded: no PTY, plain pipes.
    const full = [bin, ...args].map(winQuote).join(" ");
    child = childSpawn(full, {
      cwd, env: fullEnv, stdio: ["pipe", "pipe", "pipe"],
      shell: true, windowsHide: true,
    });
  }

  const dataCbs = [];
  const emit = (buf) => { const s = buf.toString(); for (const cb of dataCbs) cb(s); };
  child.stdout?.on("data", emit);
  child.stderr?.on("data", emit);

  return {
    pid: child.pid,
    backend: PTY_BACKEND,
    write: (d) => { try { child.stdin?.write(d); } catch { /* ignore */ } },
    resize: () => { /* not supported by the `script`/pipe backends */ },
    kill: (sig) => { try { child.kill(sig); } catch { /* ignore */ } },
    onData: (cb) => { dataCbs.push(cb); },
    onExit: (cb) => {
      child.on("close", (exitCode, signal) => cb({ exitCode, signal }));
      child.on("error", (error) => cb({ error }));
    },
  };
}
