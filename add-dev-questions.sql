-- Add sample test questions to dev database for testing
-- These are taken from production but adapted for dev testing

INSERT INTO test_questions (category, level, question_text, options, correct_answer) VALUES
('vocabulary', 'A2', 'My dad always ___ the car to work in the morning.', '["drives", "rides", "walks", "flies"]', 'drives'),
('vocabulary', 'A2', 'I always use a ___ to write in my notebook.', '["pen", "book", "phone", "desk"]', 'pen'),
('vocabulary', 'A2', 'I am sorry, I do not ___ what you mean.', '["understand", "listen", "speak", "ask"]', 'understand'),
('vocabulary', 'A2', 'We usually go to the ___ on Sundays.', '["park", "work", "school", "hospital"]', 'park'),
('vocabulary', 'A2', 'Can you ___ me with my homework?', '["help", "make", "give", "take"]', 'help'),

('grammar', 'A2', 'She ___ to school every day.', '["go", "goes", "going", "gone"]', 'goes'),
('grammar', 'A2', 'I ___ watching TV when you called.', '["am", "was", "were", "be"]', 'was'),
('grammar', 'A2', 'They ___ not come to the party.', '["do", "does", "did", "done"]', 'did'),
('grammar', 'A2', 'This is ___ book.', '["mine", "my", "me", "I"]', 'my'),
('grammar', 'A2', 'How ___ apples do you want?', '["much", "many", "some", "any"]', 'many'),

('reading', 'A2', 'Read: "John is 25 years old. He works in a bank." How old is John?', '["20", "25", "30", "35"]', '25'),
('reading', 'A2', 'Read: "The shop opens at 9 AM and closes at 6 PM." When does the shop close?', '["9 AM", "6 PM", "8 PM", "10 PM"]', '6 PM'); 