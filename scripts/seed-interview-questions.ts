import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jmrbyubrrpxxvotsljms.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const COMPANIES = [
  { slug: 'google', name: 'Google' },
  { slug: 'meta', name: 'Meta' },
  { slug: 'apple', name: 'Apple' },
  { slug: 'amazon', name: 'Amazon' },
  { slug: 'microsoft', name: 'Microsoft' },
  { slug: 'netflix', name: 'Netflix' },
  { slug: 'stripe', name: 'Stripe' },
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'anthropic', name: 'Anthropic' },
  { slug: 'databricks', name: 'Databricks' },
  { slug: 'nvidia', name: 'NVIDIA' },
  { slug: 'figma', name: 'Figma' },
  { slug: 'airbnb', name: 'Airbnb' },
  { slug: 'uber', name: 'Uber' },
  { slug: 'lyft', name: 'Lyft' },
  { slug: 'coinbase', name: 'Coinbase' },
  { slug: 'doordash', name: 'DoorDash' },
  { slug: 'robinhood', name: 'Robinhood' },
  { slug: 'palantir', name: 'Palantir' },
  { slug: 'snowflake', name: 'Snowflake' },
];

const CODING_QUESTIONS = [
  { title: 'Two Sum', text: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.', difficulty: 'easy' },
  { title: 'LRU Cache', text: 'Design a data structure that follows the constraints of a Least Recently Used (LRU) cache.', difficulty: 'medium' },
  { title: 'Merge K Sorted Lists', text: 'You are given an array of k linked-lists lists, each linked-list is sorted in ascending order. Merge all the linked-lists into one sorted linked-list.', difficulty: 'hard' },
  { title: 'Valid Parentheses', text: 'Given a string s containing just the characters \'(\', \')\', \'{\', \'}\', \'[\' and \']\', determine if the input string is valid.', difficulty: 'easy' },
  { title: 'Course Schedule', text: 'There are a total of numCourses courses you have to take. Some courses may have prerequisites. Determine if you can finish all courses.', difficulty: 'medium' },
  { title: 'Word Search II', text: 'Given an m x n board of characters and a list of strings words, return all words on the board. Each word must be constructed from letters of sequentially adjacent cells.', difficulty: 'hard' },
  { title: 'Binary Tree Level Order', text: 'Given the root of a binary tree, return the level order traversal of its nodes\' values.', difficulty: 'medium' },
  { title: 'Maximum Subarray', text: 'Given an integer array nums, find the subarray with the largest sum, and return its sum.', difficulty: 'medium' },
  { title: 'Serialize Binary Tree', text: 'Design an algorithm to serialize and deserialize a binary tree. Implement both serialize and deserialize functions.', difficulty: 'hard' },
  { title: 'Number of Islands', text: 'Given an m x n 2D binary grid which represents a map of \'1\'s (land) and \'0\'s (water), return the number of islands.', difficulty: 'medium' },
  { title: 'Rotate Image', text: 'You are given an n x n 2D matrix representing an image, rotate the image by 90 degrees clockwise in-place.', difficulty: 'medium' },
  { title: 'Meeting Rooms II', text: 'Given an array of meeting time intervals, find the minimum number of conference rooms required.', difficulty: 'medium' },
  { title: 'Alien Dictionary', text: 'Given a sorted dictionary of an alien language, find the order of characters in the alphabet.', difficulty: 'hard' },
  { title: 'Product of Array Except Self', text: 'Given an integer array nums, return an array answer such that answer[i] is equal to the product of all elements except nums[i].', difficulty: 'medium' },
  { title: 'Median of Two Sorted Arrays', text: 'Given two sorted arrays nums1 and nums2, return the median of the two sorted arrays.', difficulty: 'hard' },
];

const SYSTEM_DESIGN_QUESTIONS = [
  { title: 'Design Twitter', text: 'Design a simplified version of Twitter where users can post tweets, follow other users, and view a news feed.', difficulty: 'hard' },
  { title: 'Design URL Shortener', text: 'Design a URL shortening service like bit.ly. Support URL shortening and redirection.', difficulty: 'medium' },
  { title: 'Design Rate Limiter', text: 'Design a rate limiter that limits the number of requests a user can make to an API within a time window.', difficulty: 'medium' },
  { title: 'Design Notification System', text: 'Design a scalable notification system that can send push notifications, emails, and SMS to millions of users.', difficulty: 'hard' },
  { title: 'Design Google Maps', text: 'Design a navigation system like Google Maps. Include routing, traffic data, and ETA calculations.', difficulty: 'hard' },
  { title: 'Design Chat System', text: 'Design a real-time chat application like WhatsApp or Slack with 1:1 and group messaging.', difficulty: 'hard' },
  { title: 'Design Video Streaming', text: 'Design a video streaming service like YouTube or Netflix. Consider video upload, storage, and playback.', difficulty: 'hard' },
  { title: 'Design Web Crawler', text: 'Design a distributed web crawler that can crawl billions of web pages efficiently.', difficulty: 'medium' },
];

const BEHAVIORAL_QUESTIONS = [
  { title: 'Conflict Resolution', text: 'Tell me about a time when you had a disagreement with a teammate. How did you resolve it?', difficulty: 'medium' },
  { title: 'Failed Project', text: 'Describe a project that didn\'t go as planned. What did you learn from it?', difficulty: 'medium' },
  { title: 'Leadership Example', text: 'Tell me about a time when you took the lead on a project. What was the outcome?', difficulty: 'medium' },
  { title: 'Tight Deadline', text: 'Describe a situation where you had to deliver under a very tight deadline. How did you manage it?', difficulty: 'medium' },
  { title: 'Feedback Received', text: 'Tell me about constructive feedback you received. How did you respond to it?', difficulty: 'easy' },
  { title: 'Ambiguous Problem', text: 'Describe a time when you had to work with incomplete information or ambiguous requirements.', difficulty: 'medium' },
  { title: 'Cross-team Collaboration', text: 'Tell me about a time when you had to collaborate with a team outside your immediate group.', difficulty: 'medium' },
];

const OA_QUESTIONS = [
  { title: 'Maximum Path Sum', text: 'Online Assessment: Find the maximum sum path from top-left to bottom-right in a grid, moving only right or down.', difficulty: 'medium' },
  { title: 'String Manipulation', text: 'OA Problem: Given a string, remove the minimum number of characters to make all adjacent characters different.', difficulty: 'medium' },
  { title: 'Task Scheduler', text: 'Amazon OA: Given a list of tasks and cooling time between same tasks, find the minimum time to complete all tasks.', difficulty: 'medium' },
  { title: 'Warehouse Robot', text: 'Amazon OA: A robot in a warehouse needs to collect items. Find the shortest path visiting all items.', difficulty: 'hard' },
  { title: 'Music Pairs', text: 'Amazon OA: Find pairs of songs whose total duration is divisible by 60.', difficulty: 'medium' },
];

const POSITIONS = ['Software Engineer', 'Software Engineer - New Grad', 'Software Engineer Intern', 'Backend Engineer', 'Frontend Engineer', 'Full Stack Engineer', 'ML Engineer', 'Data Engineer'];
const LEVELS = ['new_grad', 'intern', 'junior'];
const ROUNDS = ['Phone Screen', 'Technical Phone', 'Onsite Round 1', 'Onsite Round 2', 'Final Round', 'Virtual Onsite', 'Hiring Manager'];
const SOURCES = ['leetcode_discuss', 'glassdoor', 'blind', 'reddit', '1point3acres', 'user_submission'];

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(monthsBack: number): string {
  const now = new Date();
  const daysBack = Math.floor(Math.random() * monthsBack * 30);
  now.setDate(now.getDate() - daysBack);
  return now.toISOString().split('T')[0];
}

function generateQuestions(): any[] {
  const questions: any[] = [];

  for (const company of COMPANIES) {
    const numQuestions = 3 + Math.floor(Math.random() * 5);

    for (let i = 0; i < numQuestions; i++) {
      const questionType = randomChoice(['technical_coding', 'technical_coding', 'technical_coding', 'system_design', 'behavioral', 'oa']);
      let questionData;

      switch (questionType) {
        case 'technical_coding':
          questionData = randomChoice(CODING_QUESTIONS);
          break;
        case 'system_design':
          questionData = randomChoice(SYSTEM_DESIGN_QUESTIONS);
          break;
        case 'behavioral':
          questionData = randomChoice(BEHAVIORAL_QUESTIONS);
          break;
        case 'oa':
          questionData = randomChoice(OA_QUESTIONS);
          break;
        default:
          questionData = randomChoice(CODING_QUESTIONS);
      }

      questions.push({
        company_slug: company.slug,
        company_name: company.name,
        position: randomChoice(POSITIONS),
        position_level: randomChoice(LEVELS),
        question_type: questionType,
        question_title: questionData.title,
        question_text: questionData.text,
        difficulty: questionData.difficulty as 'easy' | 'medium' | 'hard',
        interview_date: randomDate(5),
        interview_round: randomChoice(ROUNDS),
        source_name: randomChoice(SOURCES),
        is_verified: Math.random() > 0.7,
        upvotes: Math.floor(Math.random() * 50),
        scraped_at: new Date().toISOString(),
        is_duplicate: false,
      });
    }
  }

  return questions;
}

async function seedQuestions() {
  console.log('Generating sample interview questions...');
  const questions = generateQuestions();
  console.log(`Generated ${questions.length} questions`);

  console.log('Inserting into database...');
  const { data, error } = await supabase
    .from('interview_questions')
    .upsert(questions, { onConflict: 'company_slug,question_text' })
    .select('id');

  if (error) {
    console.error('Error inserting questions:', error);
    process.exit(1);
  }

  console.log(`Successfully inserted ${data?.length || 0} questions!`);

  const { count } = await supabase
    .from('interview_questions')
    .select('*', { count: 'exact', head: true });

  console.log(`Total questions in database: ${count}`);
}

seedQuestions();
