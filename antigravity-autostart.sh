#!/usr/bin/env bash
set -e

if [ "$(id -un)" != "codespace" ]; then
    exec su - codespace -c "bash /workspaces/virtual-machine/antigravity-autostart.sh"
fi

export PATH="/home/codespace/.local/bin:/usr/local/bin:$PATH"

if ! tmux has-session -t agy-daemon 2>/dev/null; then
    echo "[$(date -u)] Starting agy remote-control daemon..." >> /home/codespace/.gemini/antigravity-cli/autostart.log
    tmux new-session -d -s agy-daemon "agy remote-control serve"
else
    echo "[$(date -u)] agy-daemon is already running." >> /home/codespace/.gemini/antigravity-cli/autostart.log
fi
