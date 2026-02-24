#!/bin/bash
# Sends a recurring test message directly to Telegram via POST /send.
# Uses a file-based counter since this bypasses Claude sessions entirely.

set -euo pipefail

BARECLAW_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${BARECLAW_PORT:-3000}"
RUNTIME_DIR="${HOME}/.bareclaw"

# Load config from .env if available
TOKEN=""
CHANNEL=""
if [ -f "$BARECLAW_DIR/.env" ]; then
  TOKEN=$(grep -E '^BARECLAW_HTTP_TOKEN=' "$BARECLAW_DIR/.env" | cut -d= -f2-)
  ALLOWED=$(grep -E '^BARECLAW_ALLOWED_USERS=' "$BARECLAW_DIR/.env" | cut -d= -f2-)
  if [ -n "$ALLOWED" ]; then
    CHANNEL="tg-${ALLOWED%%,*}"
  fi
  _rd=$(grep -E '^BARECLAW_RUNTIME_DIR=' "$BARECLAW_DIR/.env" | cut -d= -f2-)
  [ -n "$_rd" ] && RUNTIME_DIR="${_rd/#\~/$HOME}"
fi

mkdir -p "$RUNTIME_DIR"
LOG="$RUNTIME_DIR/test-message.log"
COUNTER_FILE="$RUNTIME_DIR/test-counter"
CHANNEL="${CHANNEL:-${1:?Usage: test-message.sh [channel]}}"

# Increment counter
COUNT=0
if [ -f "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE")
fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

echo "[$(date)] Sending test message #$COUNT" >> "$LOG"

AUTH_HEADER=""
if [ -n "$TOKEN" ]; then
  AUTH_HEADER="-H"
  AUTH_VALUE="Authorization: Bearer $TOKEN"
fi

RESPONSE=$(curl -sf -X POST "http://localhost:$PORT/send" \
  -H 'Content-Type: application/json' \
  ${AUTH_HEADER:+"$AUTH_HEADER" "$AUTH_VALUE"} \
  -d "{\"channel\":\"$CHANNEL\",\"text\":\"Test message #$COUNT\"}" 2>&1) || {
  echo "[$(date)] Failed to send: $RESPONSE" >> "$LOG"
  exit 1
}

echo "[$(date)] Sent #$COUNT — response: $RESPONSE" >> "$LOG"
