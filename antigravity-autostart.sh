#!/usr/bin/env bash
set -e

# Ensure tmux is available
if ! command -v tmux >/dev/null 2>&1; then
    if [ "$(id -u)" -eq 0 ]; then
        apt-get update -y && apt-get install -y tmux
    elif command -v sudo >/dev/null 2>&1; then
        sudo apt-get update -y && sudo apt-get install -y tmux
    fi
fi

# If invoked as root, execute as codespace user
if [ "$(id -un)" != "codespace" ]; then
    exec su - codespace -c "bash /workspaces/virtual-machine/antigravity-autostart.sh"
fi

export PATH="/home/codespace/.local/bin:/usr/local/bin:$PATH"

# Ensure local bin link exists
if [ ! -L "/usr/local/bin/agy" ] && [ -x "/home/codespace/.local/bin/agy" ]; then
    sudo ln -sf /home/codespace/.local/bin/agy /usr/local/bin/agy 2>/dev/null || true
fi

# Ensure autostart script is installed in /usr/local/bin
if [ ! -f "/usr/local/bin/antigravity-autostart.sh" ] && [ -f "/workspaces/virtual-machine/antigravity-autostart.sh" ]; then
    sudo cp /workspaces/virtual-machine/antigravity-autostart.sh /usr/local/bin/antigravity-autostart.sh 2>/dev/null || true
    sudo chmod +x /usr/local/bin/antigravity-autostart.sh 2>/dev/null || true
fi

# Start or keep alive the agy-daemon tmux session
mkdir -p /home/codespace/.gemini/antigravity-cli

if ! tmux has-session -t agy-daemon 2>/dev/null; then
    echo "[$(date -u)] Starting resilient agy remote-control supervisor..." >> /home/codespace/.gemini/antigravity-cli/autostart.log
    tmux new-session -d -s agy-daemon "bash -c 'while true; do agy remote-control serve; echo \"[\$(date -u)] Daemon exited with status \$?, restarting in 5s...\"; sleep 5; done'"
else
    echo "[$(date -u)] agy-daemon session is already active." >> /home/codespace/.gemini/antigravity-cli/autostart.log
fi
