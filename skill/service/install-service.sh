#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Agent Watch — install the bridge as a service that auto-starts on boot.
#
#   Linux : systemd unit (system-wide by default; --user for a user unit)
#   macOS : launchd LaunchAgent
#
# Usage:
#   ./install-service.sh                 # install + enable + start
#   ./install-service.sh --user          # Linux: per-user unit (no sudo)
#   ./install-service.sh --uninstall     # stop + remove
#   ./install-service.sh --status        # show status / logs hint
#
# Secrets (Telegram token, etc.) live in ~/.config/claude-watch/bridge.env —
# created from bridge.env.example on first run. Edit it, then restart.
# ---------------------------------------------------------------------------
set -euo pipefail

SERVICE_NAME="claude-watch-bridge"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_DIR="$(cd "$SCRIPT_DIR/../bridge" && pwd)"
OS="$(uname -s)"

MODE="system"   # system | user (Linux only)
ACTION="install"
for arg in "$@"; do
  case "$arg" in
    --user) MODE="user" ;;
    --system) MODE="system" ;;
    --uninstall|--remove) ACTION="uninstall" ;;
    --status) ACTION="status" ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# --- Resolve invoking user / home (handles sudo) ---------------------------
if [ "$OS" = "Linux" ] && [ "$MODE" = "system" ]; then
  RUN_USER="${SUDO_USER:-$(id -un)}"
else
  RUN_USER="$(id -un)"
fi
RUN_HOME="$(eval echo "~$RUN_USER")"
ENV_DIR="$RUN_HOME/.config/claude-watch"
ENV_FILE="$ENV_DIR/bridge.env"

NODE_BIN="$(command -v node || true)"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }

ensure_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    mkdir -p "$ENV_DIR"
    cp "$BRIDGE_DIR/bridge.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    [ -n "${SUDO_USER:-}" ] && chown "$RUN_USER" "$ENV_DIR" "$ENV_FILE" 2>/dev/null || true
    warn "Created $ENV_FILE — edit it to add your Telegram token/chat id, then restart the service."
  fi
}

check_prereqs() {
  [ -n "$NODE_BIN" ] || { warn "node not found on PATH. Install Node.js 18+ first."; exit 1; }
  if [ ! -d "$BRIDGE_DIR/node_modules" ]; then
    warn "Dependencies not installed. Run: (cd '$BRIDGE_DIR' && npm install)"
    exit 1
  fi
}

# ===========================================================================
# Linux / systemd
# ===========================================================================
linux_unit_path() {
  if [ "$MODE" = "system" ]; then echo "/etc/systemd/system/${SERVICE_NAME}.service";
  else echo "$RUN_HOME/.config/systemd/user/${SERVICE_NAME}.service"; fi
}

linux_systemctl() {
  if [ "$MODE" = "system" ]; then sudo systemctl "$@"; else systemctl --user "$@"; fi
}

linux_install() {
  check_prereqs
  ensure_env_file
  local unit; unit="$(linux_unit_path)"
  local node_dir claude_dir path_extra
  node_dir="$(dirname "$NODE_BIN")"
  claude_dir="$(dirname "$(command -v claude || echo "$RUN_HOME/.local/bin/claude")")"
  path_extra="${node_dir}:${claude_dir}:${RUN_HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin"

  local user_line=""
  [ "$MODE" = "system" ] && user_line="User=${RUN_USER}"

  local content
  content="$(cat <<EOF
[Unit]
Description=Agent Watch bridge (Claude Code -> Apple Watch)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
${user_line}
WorkingDirectory=${BRIDGE_DIR}
EnvironmentFile=-${ENV_FILE}
Environment=HOME=${RUN_HOME}
Environment=PATH=${path_extra}
ExecStart=${NODE_BIN} ${BRIDGE_DIR}/server.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=$([ "$MODE" = "system" ] && echo multi-user.target || echo default.target)
EOF
)"

  say "Installing systemd unit ($MODE): $unit"
  if [ "$MODE" = "system" ]; then
    printf '%s\n' "$content" | sudo tee "$unit" >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now "$SERVICE_NAME"
  else
    mkdir -p "$(dirname "$unit")"
    printf '%s\n' "$content" > "$unit"
    systemctl --user daemon-reload
    systemctl --user enable --now "$SERVICE_NAME"
    # Survive logout/reboot without an active session.
    loginctl enable-linger "$RUN_USER" 2>/dev/null || warn "Could not enable linger; service may stop on logout."
  fi
  say "Done. Status:"
  linux_systemctl status "$SERVICE_NAME" --no-pager -l | head -12 || true
  say "Logs: $([ "$MODE" = system ] && echo "sudo journalctl -u $SERVICE_NAME -f" || echo "journalctl --user -u $SERVICE_NAME -f")"
}

linux_uninstall() {
  local unit; unit="$(linux_unit_path)"
  linux_systemctl disable --now "$SERVICE_NAME" 2>/dev/null || true
  if [ "$MODE" = "system" ]; then sudo rm -f "$unit"; sudo systemctl daemon-reload;
  else rm -f "$unit"; systemctl --user daemon-reload; fi
  say "Removed $SERVICE_NAME. (Env file kept: $ENV_FILE)"
}

linux_status() {
  linux_systemctl status "$SERVICE_NAME" --no-pager -l | head -20 || true
}

# ===========================================================================
# macOS / launchd
# ===========================================================================
MAC_LABEL="com.claudewatch.bridge"
MAC_PLIST="$RUN_HOME/Library/LaunchAgents/${MAC_LABEL}.plist"

mac_install() {
  check_prereqs
  ensure_env_file
  mkdir -p "$(dirname "$MAC_PLIST")"
  cat > "$MAC_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${BRIDGE_DIR}/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>${BRIDGE_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${RUN_HOME}/Library/Logs/claude-watch-bridge.log</string>
  <key>StandardErrorPath</key><string>${RUN_HOME}/Library/Logs/claude-watch-bridge.log</string>
</dict>
</plist>
EOF
  launchctl unload "$MAC_PLIST" 2>/dev/null || true
  launchctl load -w "$MAC_PLIST"
  say "Installed launchd agent: $MAC_PLIST"
  say "Logs: tail -f $RUN_HOME/Library/Logs/claude-watch-bridge.log"
}

mac_uninstall() {
  launchctl unload "$MAC_PLIST" 2>/dev/null || true
  rm -f "$MAC_PLIST"
  say "Removed launchd agent. (Env file kept: $ENV_FILE)"
}

mac_status() {
  launchctl list | grep "$MAC_LABEL" || echo "Not loaded."
}

# ===========================================================================
case "$OS" in
  Linux)  case "$ACTION" in install) linux_install ;; uninstall) linux_uninstall ;; status) linux_status ;; esac ;;
  Darwin) case "$ACTION" in install) mac_install ;; uninstall) mac_uninstall ;; status) mac_status ;; esac ;;
  *) warn "Unsupported OS: $OS. On Windows use NSSM or Task Scheduler (see README)."; exit 1 ;;
esac
