#!/bin/bash

echo "🔄 Copying test questions from production to dev database..."

# Get all test questions and pipe them directly to dev database
echo "📤 Exporting and importing test questions..."

# Export in INSERT format and import in one go
npx wrangler d1 execute user_db --remote --command "SELECT 'INSERT INTO test_questions (category, level, question_text, options, correct_answer) VALUES (' || quote(category) || ', ' || quote(level) || ', ' || quote(question_text) || ', ' || quote(options) || ', ' || quote(correct_answer) || ');' as stmt FROM test_questions;" | grep "INSERT INTO" | while read line; do
  echo "Importing: $line"
  npx wrangler d1 execute dev_user_db --remote --command "$line" 2>/dev/null || echo "Failed to import one record"
done

# Verify the count
echo "✅ Verifying import..."
DEV_COUNT=$(npx wrangler d1 execute dev_user_db --remote --command "SELECT COUNT(*) as count FROM test_questions;" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
PROD_COUNT=$(npx wrangler d1 execute user_db --remote --command "SELECT COUNT(*) as count FROM test_questions;" 2>/dev/null | grep -oE '[0-9]+' | tail -1)

echo "📊 Production database: $PROD_COUNT questions"
echo "📊 Dev database: $DEV_COUNT questions"

if [ "$DEV_COUNT" = "$PROD_COUNT" ]; then
  echo "✅ All test questions copied successfully!"
else
  echo "⚠️  Partial copy: $DEV_COUNT out of $PROD_COUNT questions copied"
fi 