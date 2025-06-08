-- Export all test questions from production
-- This script should be run with: npx wrangler d1 execute user_db --remote --file export-test-questions.sql

.headers off
.mode list
.separator ""

SELECT 'INSERT INTO test_questions (category, level, question_text, options, correct_answer) VALUES (' 
    || quote(category) || ', ' 
    || quote(level) || ', ' 
    || quote(question_text) || ', ' 
    || quote(options) || ', ' 
    || quote(correct_answer) || ');'
FROM test_questions; 