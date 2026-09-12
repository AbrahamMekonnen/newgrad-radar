-- Seed sample interview questions for testing
-- Run this migration to populate the interview_questions table

INSERT INTO interview_questions (company_slug, company_name, position, position_level, question_type, question_title, question_text, difficulty, interview_date, interview_round, source_name, is_verified, upvotes, is_duplicate)
VALUES
-- Google
('google', 'Google', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Two Sum', 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.', 'easy', CURRENT_DATE - INTERVAL '15 days', 'Phone Screen', 'leetcode_discuss', true, 42, false),
('google', 'Google', 'Software Engineer', 'new_grad', 'technical_coding', 'LRU Cache', 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.', 'medium', CURRENT_DATE - INTERVAL '23 days', 'Onsite Round 1', 'blind', true, 38, false),
('google', 'Google', 'Backend Engineer', 'new_grad', 'system_design', 'Design URL Shortener', 'Design a URL shortening service like bit.ly. Support URL shortening and redirection.', 'medium', CURRENT_DATE - INTERVAL '10 days', 'Onsite Round 2', 'glassdoor', true, 55, false),
('google', 'Google', 'Software Engineer', 'intern', 'behavioral', 'Leadership Example', 'Tell me about a time when you took the lead on a project. What was the outcome?', 'medium', CURRENT_DATE - INTERVAL '5 days', 'Hiring Manager', '1point3acres', false, 12, false),
('google', 'Google', 'ML Engineer', 'new_grad', 'technical_coding', 'Merge K Sorted Lists', 'You are given an array of k linked-lists lists, each linked-list is sorted in ascending order. Merge all the linked-lists into one sorted linked-list.', 'hard', CURRENT_DATE - INTERVAL '30 days', 'Technical Phone', 'leetcode_discuss', true, 67, false),

-- Meta
('meta', 'Meta', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Valid Parentheses', 'Given a string s containing just the characters ''('', '')'', ''{'', ''}'', ''['' and '']'', determine if the input string is valid.', 'easy', CURRENT_DATE - INTERVAL '8 days', 'Phone Screen', 'blind', true, 33, false),
('meta', 'Meta', 'Frontend Engineer', 'new_grad', 'technical_coding', 'Binary Tree Level Order', 'Given the root of a binary tree, return the level order traversal of its nodes'' values.', 'medium', CURRENT_DATE - INTERVAL '18 days', 'Onsite Round 1', 'glassdoor', true, 29, false),
('meta', 'Meta', 'Software Engineer', 'new_grad', 'system_design', 'Design Chat System', 'Design a real-time chat application like WhatsApp or Slack with 1:1 and group messaging.', 'hard', CURRENT_DATE - INTERVAL '25 days', 'Onsite Round 2', 'leetcode_discuss', true, 71, false),
('meta', 'Meta', 'Software Engineer Intern', 'intern', 'technical_coding', 'Number of Islands', 'Given an m x n 2D binary grid representing a map of ''1''s (land) and ''0''s (water), return the number of islands.', 'medium', CURRENT_DATE - INTERVAL '12 days', 'Technical Phone', 'reddit', false, 25, false),
('meta', 'Meta', 'Full Stack Engineer', 'new_grad', 'behavioral', 'Conflict Resolution', 'Tell me about a time when you had a disagreement with a teammate. How did you resolve it?', 'medium', CURRENT_DATE - INTERVAL '3 days', 'Hiring Manager', 'glassdoor', false, 18, false),

-- Apple
('apple', 'Apple', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Maximum Subarray', 'Given an integer array nums, find the subarray with the largest sum, and return its sum.', 'medium', CURRENT_DATE - INTERVAL '20 days', 'Phone Screen', 'glassdoor', true, 44, false),
('apple', 'Apple', 'iOS Engineer', 'new_grad', 'technical_coding', 'Rotate Image', 'You are given an n x n 2D matrix representing an image, rotate the image by 90 degrees clockwise in-place.', 'medium', CURRENT_DATE - INTERVAL '35 days', 'Onsite Round 1', 'blind', true, 31, false),
('apple', 'Apple', 'Software Engineer', 'new_grad', 'system_design', 'Design Notification System', 'Design a scalable notification system that can send push notifications, emails, and SMS to millions of users.', 'hard', CURRENT_DATE - INTERVAL '45 days', 'Final Round', 'leetcode_discuss', true, 52, false),
('apple', 'Apple', 'Software Engineer Intern', 'intern', 'behavioral', 'Failed Project', 'Describe a project that didn''t go as planned. What did you learn from it?', 'medium', CURRENT_DATE - INTERVAL '7 days', 'Hiring Manager', '1point3acres', false, 15, false),

-- Amazon
('amazon', 'Amazon', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Course Schedule', 'There are a total of numCourses courses you have to take. Some courses may have prerequisites. Determine if you can finish all courses.', 'medium', CURRENT_DATE - INTERVAL '11 days', 'Phone Screen', 'leetcode_discuss', true, 48, false),
('amazon', 'Amazon', 'SDE I', 'new_grad', 'oa', 'Task Scheduler', 'Amazon OA: Given a list of tasks and cooling time between same tasks, find the minimum time to complete all tasks.', 'medium', CURRENT_DATE - INTERVAL '4 days', 'Online Assessment', 'blind', true, 89, false),
('amazon', 'Amazon', 'Software Engineer', 'new_grad', 'oa', 'Music Pairs', 'Amazon OA: Find pairs of songs whose total duration is divisible by 60.', 'medium', CURRENT_DATE - INTERVAL '9 days', 'Online Assessment', 'leetcode_discuss', true, 76, false),
('amazon', 'Amazon', 'Backend Engineer', 'new_grad', 'system_design', 'Design Rate Limiter', 'Design a rate limiter that limits the number of requests a user can make to an API within a time window.', 'medium', CURRENT_DATE - INTERVAL '28 days', 'Onsite Round 2', 'glassdoor', true, 63, false),
('amazon', 'Amazon', 'Software Engineer Intern', 'intern', 'behavioral', 'Tight Deadline', 'Describe a situation where you had to deliver under a very tight deadline. How did you manage it?', 'medium', CURRENT_DATE - INTERVAL '14 days', 'Final Round', '1point3acres', false, 22, false),

-- Microsoft
('microsoft', 'Microsoft', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Product of Array Except Self', 'Given an integer array nums, return an array answer such that answer[i] is equal to the product of all elements except nums[i].', 'medium', CURRENT_DATE - INTERVAL '16 days', 'Phone Screen', 'glassdoor', true, 37, false),
('microsoft', 'Microsoft', 'Software Engineer', 'new_grad', 'technical_coding', 'Serialize Binary Tree', 'Design an algorithm to serialize and deserialize a binary tree. Implement both serialize and deserialize functions.', 'hard', CURRENT_DATE - INTERVAL '22 days', 'Onsite Round 1', 'leetcode_discuss', true, 45, false),
('microsoft', 'Microsoft', 'Full Stack Engineer', 'new_grad', 'system_design', 'Design Twitter', 'Design a simplified version of Twitter where users can post tweets, follow other users, and view a news feed.', 'hard', CURRENT_DATE - INTERVAL '33 days', 'Onsite Round 2', 'blind', true, 58, false),
('microsoft', 'Microsoft', 'Software Engineer Intern', 'intern', 'behavioral', 'Ambiguous Problem', 'Describe a time when you had to work with incomplete information or ambiguous requirements.', 'medium', CURRENT_DATE - INTERVAL '6 days', 'Hiring Manager', 'glassdoor', false, 19, false),

-- Stripe
('stripe', 'Stripe', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Meeting Rooms II', 'Given an array of meeting time intervals, find the minimum number of conference rooms required.', 'medium', CURRENT_DATE - INTERVAL '19 days', 'Phone Screen', 'blind', true, 41, false),
('stripe', 'Stripe', 'Backend Engineer', 'new_grad', 'system_design', 'Design Payment System', 'Design a payment processing system like Stripe or PayPal.', 'hard', CURRENT_DATE - INTERVAL '27 days', 'Onsite Round 2', 'glassdoor', true, 82, false),
('stripe', 'Stripe', 'Software Engineer', 'new_grad', 'technical_coding', 'Alien Dictionary', 'Given a sorted dictionary of an alien language, find the order of characters in the alphabet.', 'hard', CURRENT_DATE - INTERVAL '40 days', 'Onsite Round 1', 'leetcode_discuss', true, 54, false),

-- OpenAI
('openai', 'OpenAI', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Word Search II', 'Given an m x n board of characters and a list of strings words, return all words on the board.', 'hard', CURRENT_DATE - INTERVAL '13 days', 'Technical Phone', 'blind', true, 61, false),
('openai', 'OpenAI', 'ML Engineer', 'new_grad', 'system_design', 'Design Distributed Cache', 'Design a distributed caching system like Redis or Memcached.', 'hard', CURRENT_DATE - INTERVAL '21 days', 'Onsite Round 2', 'leetcode_discuss', true, 73, false),
('openai', 'OpenAI', 'Research Engineer', 'new_grad', 'behavioral', 'Difficult Decision', 'Tell me about a difficult technical decision you had to make. How did you approach it?', 'medium', CURRENT_DATE - INTERVAL '8 days', 'Hiring Manager', 'glassdoor', false, 27, false),

-- Anthropic
('anthropic', 'Anthropic', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Trapping Rain Water', 'Given n non-negative integers representing an elevation map, compute how much water it can trap after raining.', 'hard', CURRENT_DATE - INTERVAL '17 days', 'Technical Phone', 'blind', true, 49, false),
('anthropic', 'Anthropic', 'ML Engineer', 'new_grad', 'system_design', 'Design Web Crawler', 'Design a distributed web crawler that can crawl billions of web pages efficiently.', 'medium', CURRENT_DATE - INTERVAL '24 days', 'Onsite Round 1', 'glassdoor', true, 56, false),
('anthropic', 'Anthropic', 'Research Engineer', 'new_grad', 'behavioral', 'Cross-team Collaboration', 'Tell me about a time when you collaborated with a team outside your immediate group.', 'medium', CURRENT_DATE - INTERVAL '5 days', 'Final Round', 'leetcode_discuss', false, 21, false),

-- Netflix
('netflix', 'Netflix', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Clone Graph', 'Given a reference of a node in a connected undirected graph, return a deep copy of the graph.', 'medium', CURRENT_DATE - INTERVAL '26 days', 'Phone Screen', 'glassdoor', true, 35, false),
('netflix', 'Netflix', 'Backend Engineer', 'new_grad', 'system_design', 'Design Video Streaming', 'Design a video streaming service like YouTube or Netflix.', 'hard', CURRENT_DATE - INTERVAL '38 days', 'Onsite Round 2', 'blind', true, 84, false),

-- NVIDIA
('nvidia', 'NVIDIA', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Median of Two Sorted Arrays', 'Given two sorted arrays nums1 and nums2, return the median of the two sorted arrays.', 'hard', CURRENT_DATE - INTERVAL '31 days', 'Technical Phone', 'leetcode_discuss', true, 47, false),
('nvidia', 'NVIDIA', 'ML Engineer', 'new_grad', 'technical_coding', 'Longest Palindromic Substring', 'Given a string s, return the longest palindromic substring in s.', 'medium', CURRENT_DATE - INTERVAL '14 days', 'Onsite Round 1', 'glassdoor', true, 39, false),

-- Databricks
('databricks', 'Databricks', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'LRU Cache', 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.', 'medium', CURRENT_DATE - INTERVAL '9 days', 'Phone Screen', 'blind', true, 43, false),
('databricks', 'Databricks', 'Data Engineer', 'new_grad', 'system_design', 'Design Distributed Cache', 'Design a distributed caching system like Redis or Memcached.', 'hard', CURRENT_DATE - INTERVAL '29 days', 'Onsite Round 2', 'glassdoor', true, 51, false),

-- Uber
('uber', 'Uber', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Number of Islands', 'Given an m x n 2D binary grid representing a map of ''1''s (land) and ''0''s (water), return the number of islands.', 'medium', CURRENT_DATE - INTERVAL '12 days', 'Phone Screen', 'leetcode_discuss', true, 36, false),
('uber', 'Uber', 'Backend Engineer', 'new_grad', 'system_design', 'Design Google Maps', 'Design a navigation system like Google Maps. Include routing, traffic data, and ETA calculations.', 'hard', CURRENT_DATE - INTERVAL '34 days', 'Onsite Round 2', 'blind', true, 77, false),

-- Airbnb
('airbnb', 'Airbnb', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Meeting Rooms II', 'Given an array of meeting time intervals, find the minimum number of conference rooms required.', 'medium', CURRENT_DATE - INTERVAL '18 days', 'Technical Phone', 'glassdoor', true, 40, false),
('airbnb', 'Airbnb', 'Full Stack Engineer', 'new_grad', 'behavioral', 'Feedback Received', 'Tell me about constructive feedback you received. How did you respond to it?', 'easy', CURRENT_DATE - INTERVAL '7 days', 'Hiring Manager', 'blind', false, 16, false),

-- Coinbase
('coinbase', 'Coinbase', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Valid Parentheses', 'Given a string s containing just the characters ''('', '')'', ''{'', ''}'', ''['' and '']'', determine if the input string is valid.', 'easy', CURRENT_DATE - INTERVAL '11 days', 'Phone Screen', 'leetcode_discuss', true, 28, false),
('coinbase', 'Coinbase', 'Backend Engineer', 'new_grad', 'system_design', 'Design Payment System', 'Design a payment processing system like Stripe or PayPal.', 'hard', CURRENT_DATE - INTERVAL '23 days', 'Onsite Round 2', 'glassdoor', true, 65, false),

-- DoorDash
('doordash', 'DoorDash', 'Software Engineer - New Grad', 'new_grad', 'oa', 'Maximum Path Sum', 'Online Assessment: Find the maximum sum path from top-left to bottom-right in a grid.', 'medium', CURRENT_DATE - INTERVAL '6 days', 'Online Assessment', 'blind', true, 53, false),
('doordash', 'DoorDash', 'Backend Engineer', 'new_grad', 'system_design', 'Design Rate Limiter', 'Design a rate limiter that limits the number of requests a user can make to an API within a time window.', 'medium', CURRENT_DATE - INTERVAL '19 days', 'Onsite Round 1', 'leetcode_discuss', true, 46, false),

-- Robinhood
('robinhood', 'Robinhood', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Product of Array Except Self', 'Given an integer array nums, return an array answer such that answer[i] is equal to the product of all elements except nums[i].', 'medium', CURRENT_DATE - INTERVAL '15 days', 'Phone Screen', 'glassdoor', true, 32, false),
('robinhood', 'Robinhood', 'Backend Engineer', 'new_grad', 'system_design', 'Design Payment System', 'Design a payment processing system like Stripe or PayPal.', 'hard', CURRENT_DATE - INTERVAL '28 days', 'Final Round', 'blind', true, 59, false),

-- Palantir
('palantir', 'Palantir', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Alien Dictionary', 'Given a sorted dictionary of an alien language, find the order of characters in the alphabet.', 'hard', CURRENT_DATE - INTERVAL '22 days', 'Onsite Round 1', 'leetcode_discuss', true, 50, false),
('palantir', 'Palantir', 'Forward Deployed Engineer', 'new_grad', 'behavioral', 'Ambiguous Problem', 'Describe a time when you had to work with incomplete information or ambiguous requirements.', 'medium', CURRENT_DATE - INTERVAL '10 days', 'Hiring Manager', 'glassdoor', false, 23, false),

-- Snowflake
('snowflake', 'Snowflake', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Course Schedule', 'There are a total of numCourses courses you have to take. Some courses may have prerequisites. Determine if you can finish all courses.', 'medium', CURRENT_DATE - INTERVAL '17 days', 'Technical Phone', 'blind', true, 38, false),
('snowflake', 'Snowflake', 'Data Engineer', 'new_grad', 'system_design', 'Design Distributed Cache', 'Design a distributed caching system like Redis or Memcached.', 'hard', CURRENT_DATE - INTERVAL '32 days', 'Onsite Round 2', 'glassdoor', true, 62, false),

-- Figma
('figma', 'Figma', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Binary Tree Level Order', 'Given the root of a binary tree, return the level order traversal of its nodes'' values.', 'medium', CURRENT_DATE - INTERVAL '13 days', 'Phone Screen', 'leetcode_discuss', true, 34, false),
('figma', 'Figma', 'Frontend Engineer', 'new_grad', 'system_design', 'Design Chat System', 'Design a real-time chat application like WhatsApp or Slack with 1:1 and group messaging.', 'hard', CURRENT_DATE - INTERVAL '25 days', 'Onsite Round 2', 'blind', true, 68, false),

-- Lyft
('lyft', 'Lyft', 'Software Engineer - New Grad', 'new_grad', 'technical_coding', 'Rotate Image', 'You are given an n x n 2D matrix representing an image, rotate the image by 90 degrees clockwise in-place.', 'medium', CURRENT_DATE - INTERVAL '20 days', 'Technical Phone', 'glassdoor', true, 30, false),
('lyft', 'Lyft', 'Backend Engineer', 'new_grad', 'system_design', 'Design Google Maps', 'Design a navigation system like Google Maps. Include routing, traffic data, and ETA calculations.', 'hard', CURRENT_DATE - INTERVAL '36 days', 'Final Round', 'leetcode_discuss', true, 72, false)

ON CONFLICT DO NOTHING;
