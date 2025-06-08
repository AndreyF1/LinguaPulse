#!/bin/bash

echo "🔄 Bulk copying test questions from production to dev database..."

# First, let's copy all the data in batches to avoid timeout
echo "📤 Copying questions in batches..."

# Copy in chunks of 10 questions each
for i in {0..7}; do
  OFFSET=$((i * 10))
  echo "📦 Copying batch $((i + 1))/8 (offset $OFFSET)..."
  
  npx wrangler d1 execute user_db --remote --command "
    SELECT 'INSERT INTO test_questions (category, level, question_text, options, correct_answer) VALUES (' 
      || quote(category) || ', ' 
      || quote(level) || ', ' 
      || quote(question_text) || ', ' 
      || quote(options) || ', ' 
      || quote(correct_answer) || ');' as stmt 
    FROM test_questions 
    LIMIT 10 OFFSET $OFFSET;" \
  | grep -o "INSERT INTO test_questions[^;]*;" > batch_$i.sql
  
  if [ -s batch_$i.sql ]; then
    echo "📥 Importing batch $((i + 1))..."
    while IFS= read -r sql_stmt; do
      npx wrangler d1 execute dev_user_db --remote --command "$sql_stmt" > /dev/null 2>&1
    done < batch_$i.sql
    rm batch_$i.sql
  fi
done

# Verify the final count
echo "✅ Verifying import..."
DEV_COUNT=$(npx wrangler d1 execute dev_user_db --remote --command "SELECT COUNT(*) as count FROM test_questions;" | grep -oE '[0-9]+' | tail -1)
PROD_COUNT=$(npx wrangler d1 execute user_db --remote --command "SELECT COUNT(*) as count FROM test_questions;" | grep -oE '[0-9]+' | tail -1)

echo "📊 Production database: $PROD_COUNT questions"
echo "📊 Dev database: $DEV_COUNT questions"

if [ "$DEV_COUNT" = "$PROD_COUNT" ]; then
  echo "✅ All test questions copied successfully!"
elif [ "$DEV_COUNT" -gt "0" ]; then
  echo "⚠️  Partial copy: $DEV_COUNT out of $PROD_COUNT questions copied"
else
  echo "❌ Copy failed, trying alternative method..."
fi 