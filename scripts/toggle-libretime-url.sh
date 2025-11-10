#!/bin/bash
# Toggle LibreTime public_url between public (HTTPS) and internal (HTTP) for imports

CONFIG_FILE="/srv/libretime/config.yml"
PUBLIC_URL="https://schedule.diaradio.live"
INTERNAL_URL="http://nginx:8080"

if [ "$1" = "internal" ]; then
    echo "🔄 Switching LibreTime to internal URL for imports..."
    sed -i "s|public_url: $PUBLIC_URL|public_url: $INTERNAL_URL|g" "$CONFIG_FILE"
    echo "✅ Set to: $INTERNAL_URL"
    echo "🔄 Restarting LibreTime containers..."
    cd /srv/libretime && docker compose restart api analyzer legacy
    echo "✅ Ready for bulk import (bypasses Cloudflare)"
elif [ "$1" = "public" ]; then
    echo "🔄 Switching LibreTime back to public URL..."
    sed -i "s|public_url: $INTERNAL_URL|public_url: $PUBLIC_URL|g" "$CONFIG_FILE"
    echo "✅ Set to: $PUBLIC_URL"
    echo "🔄 Restarting LibreTime containers..."
    cd /srv/libretime && docker compose restart api analyzer legacy
    echo "✅ Streaming and web UI restored"
else
    echo "Usage: $0 {internal|public}"
    echo ""
    echo "  internal - Switch to internal URL (for bulk imports)"
    echo "  public   - Switch back to public URL (for streaming/web UI)"
    exit 1
fi

