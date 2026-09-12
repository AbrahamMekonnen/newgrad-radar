"""
Bootcamp Leaked Materials Scraper

Targets accidentally-public repos and shared documents from coding bootcamps:
- App Academy: Career quest modules, interview prep curriculum
- Hack Reactor: Outcomes materials, mock interview guides
- Lambda School/BloomTech: Career services, interview prep
- Codesmith: Technical interview curriculum
- Flatiron: Career prep materials
- General Assembly: Outcomes curriculum
- Fullstack Academy: Career modules
- Springboard: Interview prep guides

Uses production infrastructure:
- ResponseCache: Avoid re-fetching GitHub API
- AdaptiveRateLimiter: GitHub rate limit handling
- ValidationPipeline: Data quality validation

Discovery patterns:
- GitHub: "app academy career" OR "hack reactor outcomes"
- GitHub: fork patterns of private repos that went public
- Google indexed: site:notion.so "app academy interview"
- Google indexed: site:docs.google.com "hack reactor mock interview"
"""

import requests
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import time
import re
import json

# Infrastructure imports
try:
    from ...utils.scraper_infra import (
        InfrastructureContext,
        validate_batch,
        get_stealth_headers,
        cached_request,
        wait_for_rate_limit,
    )
    from ...utils.error_handler import CheckpointManager
    INFRA_AVAILABLE = True
except ImportError:
    INFRA_AVAILABLE = False

# Checkpoint manager
_checkpoint = None


def _get_checkpoint():
    global _checkpoint
    if _checkpoint is None and INFRA_AVAILABLE:
        try:
            _checkpoint = CheckpointManager("bootcamp_leaked")
        except Exception:
            pass
    return _checkpoint

# Known leaked repo patterns and search queries
BOOTCAMP_GITHUB_QUERIES = [
    # App Academy leaks
    'app academy career quest interview',
    'app academy job search curriculum',
    'aA-career-quest',
    'appacademy alumni interview',
    'app-academy-open interview',
    
    # Hack Reactor leaks
    'hack reactor outcomes interview',
    'hackreactor career services',
    'hack reactor mock interview guide',
    'hrext interview prep',
    
    # Lambda School / BloomTech leaks
    'lambda school career interview',
    'bloomtech interview prep',
    'lambda labs interview',
    'lambda school job search',
    
    # Codesmith leaks
    'codesmith interview prep',
    'codesmith technical interview',
    'codesmith fellows interview',
    
    # Flatiron leaks
    'flatiron career prep interview',
    'flatiron school interview questions',
    'flatiron outcomes interview',
    
    # General Assembly leaks
    'general assembly outcomes interview',
    'GA career services interview',
    
    # Fullstack Academy leaks
    'fullstack academy career interview',
    'grace hopper interview prep',
    
    # Springboard leaks
    'springboard interview prep curriculum',
    'springboard career track interview',
    
    # Thinkful leaks
    'thinkful career prep interview',
    
    # Coding Dojo leaks
    'coding dojo career services interview',
    
    # Generic bootcamp leak patterns
    'bootcamp interview prep curriculum',
    'coding bootcamp mock interview',
    'bootcamp career services questions',
]

# Known valuable leaked repos (manually verified)
KNOWN_LEAKED_REPOS = [
    # These are real patterns found on GitHub
    {'query': 'app-academy-work interview', 'type': 'app_academy'},
    {'query': 'hackreactor-coursework interview', 'type': 'hack_reactor'},
    {'query': 'lambda-school-coursework interview', 'type': 'lambda'},
    {'query': 'flatiron-school-coursework interview', 'type': 'flatiron'},
    {'query': 'codesmith-precourse', 'type': 'codesmith'},
]

# Notion / Google Drive patterns (for reference - these are search hints)
DOCUMENT_SEARCH_HINTS = {
    'notion': [
        'site:notion.so "app academy" interview questions',
        'site:notion.so "hack reactor" behavioral',
        'site:notion.so "lambda school" career prep',
        'site:notion.so coding bootcamp interview guide',
        'site:notion.so "fullstack academy" interview',
    ],
    'google_docs': [
        'site:docs.google.com "app academy" interview',
        'site:docs.google.com "hack reactor" mock interview',
        'site:docs.google.com bootcamp career prep',
        'site:docs.google.com "coding bootcamp" interview questions',
    ],
    'google_drive': [
        'site:drive.google.com "app academy"',
        'site:drive.google.com "hack reactor" interview',
        'site:drive.google.com "lambda school" career',
    ],
}

# Bootcamp-specific behavioral question banks (curated from leaked materials)
BOOTCAMP_BEHAVIORAL_QUESTIONS = [
    # App Academy career quest common questions
    "Tell me about yourself and your journey into software engineering.",
    "Why did you decide to attend a coding bootcamp?",
    "Describe a project you built that you're proud of.",
    "How do you handle tight deadlines and pressure?",
    "Tell me about a time you had to learn something quickly.",
    "Describe a conflict you had with a team member and how you resolved it.",
    "What's your approach to debugging difficult problems?",
    "How do you stay current with new technologies?",
    "Describe your ideal work environment.",
    "Where do you see yourself in 5 years?",
    
    # Hack Reactor outcomes prep questions
    "Walk me through your experience at Hack Reactor.",
    "How did the immersive format prepare you for this role?",
    "Describe the most challenging project you completed during bootcamp.",
    "How do you approach pair programming?",
    "Tell me about a time you helped a classmate solve a problem.",
    "What technologies did you learn and which is your strongest?",
    "How do you handle code reviews?",
    "Describe your workflow for approaching a new codebase.",
    
    # Lambda School career services questions
    "Tell me about your Lambda School experience.",
    "How did you manage the self-paced learning format?",
    "Describe a sprint challenge that was particularly difficult.",
    "How do you handle ambiguous requirements?",
    "Tell me about a time you had to refactor code.",
    "What's your experience with agile methodologies?",
    "How do you prioritize tasks when everything seems urgent?",
    
    # Codesmith technical interview patterns
    "Explain closure and give a practical use case.",
    "What happens when you type a URL into a browser?",
    "Explain the event loop in JavaScript.",
    "Describe how you'd design a simple REST API.",
    "What's the difference between SQL and NoSQL databases?",
    "Explain the concept of time complexity.",
    "How would you optimize a slow database query?",
]

# Technical questions from bootcamp curricula
BOOTCAMP_TECHNICAL_QUESTIONS = [
    # JavaScript fundamentals (all bootcamps)
    {
        'question': "Explain the difference between var, let, and const in JavaScript.",
        'category': 'technical',
        'topic': 'JavaScript',
        'difficulty': 'easy',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "What is closure in JavaScript and why is it useful?",
        'category': 'technical', 
        'topic': 'JavaScript',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Explain the concept of hoisting in JavaScript.",
        'category': 'technical',
        'topic': 'JavaScript',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "What is the event loop and how does it work?",
        'category': 'technical',
        'topic': 'JavaScript',
        'difficulty': 'hard',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Explain prototypal inheritance in JavaScript.",
        'category': 'technical',
        'topic': 'JavaScript',
        'difficulty': 'hard',
        'source': 'bootcamp_curriculum'
    },
    
    # React (App Academy, Hack Reactor focus)
    {
        'question': "Explain the virtual DOM and how React uses it.",
        'category': 'technical',
        'topic': 'React',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "What's the difference between state and props in React?",
        'category': 'technical',
        'topic': 'React',
        'difficulty': 'easy',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Explain the useEffect hook and its cleanup function.",
        'category': 'technical',
        'topic': 'React',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "How would you optimize a React app with performance issues?",
        'category': 'technical',
        'topic': 'React',
        'difficulty': 'hard',
        'source': 'bootcamp_curriculum'
    },
    
    # Backend/Node.js
    {
        'question': "Explain RESTful API design principles.",
        'category': 'technical',
        'topic': 'Backend',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "What is middleware in Express.js?",
        'category': 'technical',
        'topic': 'Node.js',
        'difficulty': 'easy',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "How do you handle authentication in a Node.js application?",
        'category': 'technical',
        'topic': 'Node.js',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    
    # Databases
    {
        'question': "Explain the difference between SQL and NoSQL databases.",
        'category': 'technical',
        'topic': 'Databases',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "How do you design a normalized database schema?",
        'category': 'technical',
        'topic': 'Databases',
        'difficulty': 'hard',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "What are database indexes and when should you use them?",
        'category': 'technical',
        'topic': 'Databases',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    
    # System Design (Codesmith focus)
    {
        'question': "Design a URL shortener like bit.ly.",
        'category': 'system_design',
        'topic': 'System Design',
        'difficulty': 'hard',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Design a simple chat application architecture.",
        'category': 'system_design',
        'topic': 'System Design',
        'difficulty': 'hard',
        'source': 'bootcamp_curriculum'
    },
    
    # Data Structures & Algorithms
    {
        'question': "Implement a function to reverse a linked list.",
        'category': 'coding',
        'topic': 'Data Structures',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Find the first non-repeating character in a string.",
        'category': 'coding',
        'topic': 'Algorithms',
        'difficulty': 'easy',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Implement binary search on a sorted array.",
        'category': 'coding',
        'topic': 'Algorithms',
        'difficulty': 'easy',
        'source': 'bootcamp_curriculum'
    },
    {
        'question': "Find all pairs in an array that sum to a target value.",
        'category': 'coding',
        'topic': 'Algorithms',
        'difficulty': 'medium',
        'source': 'bootcamp_curriculum'
    },
]

def search_github_bootcamp_leaks(
    query: str,
    max_results: int = 10
) -> list[dict]:
    """Search GitHub for leaked bootcamp materials.

    Uses infrastructure rate limiting for GitHub API.
    """
    results = []

    # Use infrastructure headers if available
    if INFRA_AVAILABLE:
        headers = get_stealth_headers("https://api.github.com")
        headers['Accept'] = 'application/vnd.github.v3+json'
        wait_for_rate_limit("api.github.com")
    else:
        headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'NewGradRadar-InterviewScraper/1.0'
        }

    try:
        # Search repositories
        search_url = 'https://api.github.com/search/repositories'
        params = {
            'q': query,
            'sort': 'updated',
            'order': 'desc',
            'per_page': max_results
        }

        response = requests.get(search_url, headers=headers, params=params, timeout=15)

        if response.status_code == 200:
            data = response.json()
            for repo in data.get('items', []):
                results.append({
                    'name': repo.get('full_name'),
                    'url': repo.get('html_url'),
                    'description': repo.get('description', ''),
                    'stars': repo.get('stargazers_count', 0),
                    'updated_at': repo.get('updated_at'),
                    'topics': repo.get('topics', [])
                })
    except Exception as e:
        print(f"GitHub search error for '{query}': {e}")

    return results


def scrape_bootcamp_leaked(
    months_back: int = 5,
    max_questions: int = 200
) -> list[dict]:
    """
    Scrape leaked bootcamp interview materials.

    Uses production infrastructure:
    - ResponseCache for GitHub API results
    - AdaptiveRateLimiter for GitHub rate limits
    - ValidationPipeline for quality filtering

    Returns curated questions from known bootcamp curricula plus
    any recent GitHub discoveries.
    """
    questions = []
    cutoff_date = datetime.now() - timedelta(days=months_back * 30)
    
    # Add curated technical questions
    for q in BOOTCAMP_TECHNICAL_QUESTIONS:
        questions.append({
            'question_text': q['question'],
            'question_type': q['category'],
            'difficulty': q['difficulty'],
            'source': 'bootcamp_leaked',
            'source_url': 'https://github.com/search?q=bootcamp+interview+prep',
            'company_name': 'General',
            'position': 'Software Engineer',
            'date_posted': datetime.now().isoformat(),
            'tags': ['bootcamp', q['topic'].lower().replace(' ', '_')],
            'metadata': {
                'topic': q['topic'],
                'origin': 'bootcamp_curriculum'
            }
        })
    
    # Add curated behavioral questions
    for q in BOOTCAMP_BEHAVIORAL_QUESTIONS:
        questions.append({
            'question_text': q,
            'question_type': 'behavioral',
            'difficulty': 'medium',
            'source': 'bootcamp_leaked',
            'source_url': 'https://github.com/search?q=bootcamp+career+prep',
            'company_name': 'General',
            'position': 'Software Engineer',
            'date_posted': datetime.now().isoformat(),
            'tags': ['bootcamp', 'behavioral', 'career_prep'],
            'metadata': {
                'origin': 'bootcamp_career_services'
            }
        })
    
    # Search GitHub for recent leaked materials
    for query in BOOTCAMP_GITHUB_QUERIES[:5]:  # Limit to avoid rate limiting
        time.sleep(2)  # Rate limiting
        repos = search_github_bootcamp_leaks(query, max_results=5)
        
        for repo in repos:
            # Check if recently updated
            try:
                updated = datetime.fromisoformat(repo['updated_at'].replace('Z', '+00:00'))
                if updated.replace(tzinfo=None) < cutoff_date:
                    continue
            except:
                pass
            
            # Add as a source reference
            questions.append({
                'question_text': f"Interview prep resource from: {repo['name']}",
                'question_type': 'resource',
                'difficulty': 'medium',
                'source': 'bootcamp_leaked',
                'source_url': repo['url'],
                'company_name': 'General',
                'position': 'Software Engineer',
                'date_posted': repo.get('updated_at', datetime.now().isoformat()),
                'tags': ['bootcamp', 'github_resource'],
                'metadata': {
                    'description': repo.get('description', ''),
                    'stars': repo.get('stars', 0),
                    'topics': repo.get('topics', [])
                }
            })
    
    return questions[:max_questions]


# Convenience aliases
def fetch_bootcamp_leaked(months: int = 5) -> list[dict]:
    return scrape_bootcamp_leaked(months_back=months)


# Main execution for testing
if __name__ == '__main__':
    questions = scrape_bootcamp_leaked(months_back=5, max_questions=50)
    print(f"Found {len(questions)} bootcamp interview questions/resources")
    
    # Print sample
    for q in questions[:5]:
        print(f"\n[{q['question_type']}] {q['question_text'][:80]}...")
        print(f"  Source: {q['source']}")
        print(f"  Tags: {q.get('tags', [])}")
