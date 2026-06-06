// ---------------------------------------------------------------------------
// platform.js — cross-platform helpers (binary discovery + process spawning)
//
// Keeps every OS-specific quirk in one place so server.js stays portable.
// Supported: macOS, Linux, Windows.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { execFileSync, spawn as childSpawn } from "node:child_process";

export const IS_WIN = process.platform === "win32";
export const IS_MAC = process.platform === "darwin";
export const IS_LINUX = process.platform === "linux";

/**
 * Locate an executable cross-platform.
 *
 * 1. Checks explicit candidate paths (with Windows PATHEXT extensions).
 * 2. Falls back to a PATH lookup via `where` (Windows) or `which` (POSIX).
 *
 * @param {string} name        bare command name, e.g. "claude"
 * @param {string[]} candidates absolute paths to try first
 * @returns {string|null} resolved path, or null if not found
 */
export function findBinary(name, candidates = []) {
  const exts = IS_WIN
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];

  for (const c of candidates) {
    for (const ext of exts) {
      const candidate = c + (IS_WIN ? ext : "");
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* continue */ }
    }
    // Non-Windows: also try the bare candidate (no ext loop needed)
    if (!IS_WIN) {
      try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* continue */ }
    }
  }

  try {
    const finder = IS_WIN ? "where" : "which";
    const out = execFileSync(finder, [name], { encoding: "utf-8" });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch { /* not on PATH */ }

  return null;
}

/**
 * Quote a single argument for the Windows `cmd.exe` shell.
 * Best-effort: wraps in double quotes and doubles embedded quotes.
 */
export function winQuote(arg) {
  const s = String(arg);
  if (s.length && !/[\s"&|<>^()%!]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * POSIX single-quote a shell argument (safe for `sh -c` / `script -c`).
 */
export function shQuote(arg) {
  const s = String(arg);
  if (/^[A-Za-z0-9_\-./:=@]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Spawn a CLI process cross-platform (non-interactive / headless).
 *
 * On Windows, `.cmd`/`.bat` shims (how npm installs `claude`/`codex`) can only
 * be launched through a shell, so we build a quoted command string. On POSIX we
 * spawn directly with an argv array — no shell, no quoting hazards.
 */
export function spawnCli(bin, args = [], opts = {}) {
  if (!IS_WIN) return childSpawn(bin, args, opts);
  const cmd = [bin, ...args].map(winQuote).join(" ");
  return childSpawn(cmd, { ...opts, shell: true, windowsHide: true });
}
