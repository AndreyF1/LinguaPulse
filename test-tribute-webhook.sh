#!/bin/bash

# Test Tribute webhook script for testing payment flow
# Usage: ./test-tribute-webhook.sh <user_telegram_id> [environment]

if [ -z "$1" ]; then
  echo "Usage: $0 <user_telegram_id> [environment]"
  echo "Example: $0 123456789 dev"
  echo "Example: $0 123456789 prod"
  exit 1
fi

USER_ID=$1
ENVIRONMENT=${2:-dev}

# Set webhook URL based on environment
if [ "$ENVIRONMENT" = "dev" ]; then
  WEBHOOK_URL="https://dev-telegram-webhook.andreykatkov13.workers.dev/tribute-webhook"
  echo "🧪 Testing Tribute webhook for DEV environment"
else
  WEBHOOK_URL="https://telegram-webhook.andreykatkov13.workers.dev/tribute-webhook"
  echo "🚀 Testing Tribute webhook for PRODUCTION environment"
fi

echo "👤 User ID: $USER_ID"
echo "📡 Webhook URL: $WEBHOOK_URL"
echo ""

# Create realistic Tribute webhook payload
# Based on the actual structure that Tribute sends
PAYLOAD=$(cat <<EOF
{
  "name": "new_subscription",
  "payload": {
    "telegram_user_id": "$USER_ID",
    "subscription_id": "test_sub_$(date +%s)",
    "expires_at": "$(date -d '+7 days' -Iseconds)",
    "amount": 200,
    "currency": "EUR",
    "created_at": "$(date -Iseconds)",
    "status": "active"
  },
  "timestamp": $(date +%s),
  "webhook_id": "webhook_test_$(date +%s)"
}
EOF
)

echo "📦 Sending webhook payload:"
echo "$PAYLOAD" | jq '.' 2>/dev/null || echo "$PAYLOAD"
echo ""

# Send the webhook
echo "🔄 Sending webhook request..."
RESPONSE=$(curl -s -w "\n\nHTTP_CODE:%{http_code}\nRESPONSE_TIME:%{time_total}" \
  -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "trbt-signature: test_signature_$(date +%s)" \
  -d "$PAYLOAD")

# Parse response
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
RESPONSE_TIME=$(echo "$RESPONSE" | grep "RESPONSE_TIME:" | cut -d: -f2)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/,$d')

echo "📊 Response:"
echo "Status Code: $HTTP_CODE"
echo "Response Time: ${RESPONSE_TIME}s"
echo "Response Body:"
echo "$RESPONSE_BODY" | jq '.' 2>/dev/null || echo "$RESPONSE_BODY"

# Interpret results
echo ""
if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Webhook processed successfully!"
  echo "💬 Check your Telegram bot for the subscription confirmation message"
  echo "🎯 User $USER_ID should now have an active subscription"
  echo ""
  echo "📝 Next steps to test:"
  echo "  1. Send /profile to check subscription status"
  echo "  2. Send /lesson to access premium lesson"
  echo "  3. Use /talk to test conversation mode"
elif [ "$HTTP_CODE" = "404" ]; then
  echo "❌ User not found in database"
  echo "💡 User needs to complete placement test first (/start command)"
elif [ "$HTTP_CODE" = "400" ]; then
  echo "⚠️  Bad request - check payload format"
elif [ "$HTTP_CODE" = "405" ]; then
  echo "⚠️  Method not allowed - webhook endpoint expects POST"
else
  echo "❌ Webhook failed with status code: $HTTP_CODE"
fi

echo ""
echo "🔗 Useful endpoints for testing:"
echo "  - Webhook: $WEBHOOK_URL"
echo "  - Test subscription: ${WEBHOOK_URL/tribute-webhook/test-subscription}"
echo ""
echo "📋 To test the full flow:"
echo "  1. Complete placement test: /start"
echo "  2. Run this script to simulate payment"
echo "  3. Test premium features: /lesson, /profile, /talk" 