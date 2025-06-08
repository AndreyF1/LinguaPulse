#!/bin/bash

# Test subscription script for dev environment
# Usage: ./test-subscription.sh <user_telegram_id>

if [ -z "$1" ]; then
  echo "Usage: $0 <user_telegram_id>"
  echo "Example: $0 123456789"
  exit 1
fi

USER_ID=$1
DEV_WEBHOOK_URL="https://dev-telegram-webhook.andreykatkov13.workers.dev/test-subscription"

echo "🧪 Testing subscription activation for user: $USER_ID"
echo "📡 Sending request to: $DEV_WEBHOOK_URL"

curl -X POST "$DEV_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\": \"$USER_ID\", \"action\": \"test_subscription\"}" \
  -w "\n\nResponse Code: %{http_code}\n"

echo "✅ Test subscription request sent!"
echo "Check your Telegram bot (@dev_lpulse_bot) for confirmation message." 