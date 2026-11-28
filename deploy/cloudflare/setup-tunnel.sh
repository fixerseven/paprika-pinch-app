#!/usr/bin/env bash
# One-time setup of the Cloudflare Tunnel that puts Pinch at pinch.hellopaprika.com.
# Run on the Mac mini. The login step opens a browser: sign in to Cloudflare and pick hellopaprika.com.
set -euo pipefail
HOST=pinch.hellopaprika.com
NAME=pinch

command -v cloudflared >/dev/null || brew install cloudflared
[ -f ~/.cloudflared/cert.pem ] || cloudflared tunnel login

if ! cloudflared tunnel list -o json | grep -q "\"name\":\"$NAME\""; then
  cloudflared tunnel create "$NAME"
fi
ID=$(cloudflared tunnel list -o json | python3 -c "import sys,json;print([t['id'] for t in json.load(sys.stdin) if t['name']=='$NAME'][0])")

# Adds a CNAME pinch -> <id>.cfargotunnel.com in the hellopaprika.com zone. Nothing else in the zone changes.
cloudflared tunnel route dns "$NAME" "$HOST"

mkdir -p ~/.cloudflared
sed "s/<TUNNEL_ID>/$ID/g" "$(dirname "$0")/config.yml" > ~/.cloudflared/config.yml
# Run it at boot as a LaunchAgent, next to com.paprika.pinch.
cloudflared service install 2>/dev/null || true
echo "Tunnel $NAME ($ID) is set up for https://$HOST"
