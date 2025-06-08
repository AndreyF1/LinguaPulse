#!/bin/bash

echo "🔄 Copying test questions from production to dev database..."

# Export test questions from production database
echo "📤 Exporting test questions from production..."
npx wrangler d1 execute user_db --remote --command ".dump test_questions" > test_questions_export.sql

# If the export failed, try alternative method
if [ ! -s test_questions_export.sql ]; then
  echo "📤 Using alternative export method..."
  npx wrangler d1 execute user_db --remote --command "SELECT 'INSERT INTO test_questions (id, category, level, question_text, options, correct_answer) VALUES (' || id || ', ' || quote(category) || ', ' || quote(level) || ', ' || quote(question_text) || ', ' || quote(options) || ', ' || quote(correct_answer) || ');' FROM test_questions;" > test_questions_export.sql
fi

# Import into dev database
echo "📥 Importing test questions into dev database..."
if [ -s test_questions_export.sql ]; then
  npx wrangler d1 execute dev_user_db --remote --file test_questions_export.sql
  
  # Verify import
  echo "✅ Verifying import..."
  DEV_COUNT=$(npx wrangler d1 execute dev_user_db --remote --command "SELECT COUNT(*) as count FROM test_questions;" | grep -oE '[0-9]+' | tail -1)
  echo "📊 Test questions in dev database: $DEV_COUNT"
  
  # Clean up
  rm test_questions_export.sql
  echo "✅ Test questions copied successfully!"
else
  echo "❌ Export failed, please check the database connection."
fi 