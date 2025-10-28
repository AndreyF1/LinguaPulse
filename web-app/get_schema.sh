#!/bin/bash
SUPABASE_URL="https://qpqwyvzpwwwyolnvtglw.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcXd5dnpwd3d3eW9sbnZ0Z2x3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjQ4Nzg3OSwiZXhwIjoyMDcyMDYzODc5fQ.qMTW5gsYbs7reDaF7v78x8kMSP3p11Xf6y-ZBDNA_B8"

echo "=== Getting Database Schema ==="
echo ""

# Получаем список таблиц через прямой SQL запрос
echo "1. Tables:"
curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT table_name FROM information_schema.tables WHERE table_schema = '\''public'\'' ORDER BY table_name"
  }' 2>/dev/null || echo "RPC not available, trying direct query..."

# Альтернативный способ - через PostgREST metadata
echo ""
echo "2. Trying PostgREST introspection..."
curl -s "${SUPABASE_URL}/rest/v1/" \
  -H "apikey: ${SERVICE_KEY}" \
  -H "Authorization: Bearer ${SERVICE_KEY}" | jq -r 'keys[]' 2>/dev/null || echo "Direct introspection not available"

