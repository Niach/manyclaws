#!/bin/sh
# ManyClaws entrypoint wrapper — ensures default config values before starting OpenClaw

CONFIG="$HOME/.openclaw/openclaw.json"

if [ -f "$CONFIG" ]; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$CONFIG', 'utf8'));
    let changed = false;
    if (!cfg.gateway) { cfg.gateway = {}; changed = true; }
    if (!cfg.gateway.controlUi) { cfg.gateway.controlUi = {}; changed = true; }
    if (cfg.gateway.controlUi.dangerouslyDisableDeviceAuth === undefined) {
      cfg.gateway.controlUi.dangerouslyDisableDeviceAuth = true;
      changed = true;
    }
    if (changed) fs.writeFileSync('$CONFIG', JSON.stringify(cfg, null, 2) + '\n');
  " 2>/dev/null || true
fi

exec docker-entrypoint.sh "$@"
