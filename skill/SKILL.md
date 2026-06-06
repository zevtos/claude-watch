---
name: claude-watch
description: Bridge your Claude Code session to the Agent Watch app on Apple Watch
author: shobhit
version: 0.1.0
---

# Agent Watch Bridge

Starts a local bridge server that connects your active Claude Code session
to the Agent Watch iOS/watchOS app.

## What it does
- Runs a Node.js bridge server on your LAN
- Registers HTTP hooks for real-time event forwarding
- Generates a 6-digit pairing code for the iPhone app
- Enables voice commands from your Apple Watch

## Usage
Run `/claude-watch` to start the bridge.
Enter the pairing code in the Agent Watch iPhone app.

## Setup
The bridge requires Node.js 18+ and runs on **macOS, Linux, and Windows**.
Run the setup script: `cd skill/bridge && npm install`

`node-pty` is installed as an optional dependency. It powers interactive
sessions spawned *from the watch* and is the only reliable PTY backend across
platforms. If it can't build (no compiler/prebuild), `npm install` still
succeeds — monitoring, output streaming, and permission approvals all work
without it; only wrist-initiated interactive sessions are unavailable.

Install hooks (all platforms): `node skill/setup-hooks.mjs`
(POSIX shells can also use `skill/setup-hooks.sh`, which additionally wires up
the optional `codex-watch` wrapper.)
