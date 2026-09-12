"""Configuration settings for the job scraper."""

import os
from dotenv import load_dotenv

# Load .env file if present (for local development)
load_dotenv()

# Supabase configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://jmrbyubrrpxxvotsljms.supabase.co")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Gemini API for AI classification
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# USAJobs API (free registration at https://developer.usajobs.gov/APIRequest/Index)
USAJOBS_API_KEY = os.environ.get("USAJOBS_API_KEY", "")
USAJOBS_EMAIL = os.environ.get("USAJOBS_EMAIL", "")

# Adzuna API (free tier: 1,000 calls/month - register at https://developer.adzuna.com)
ADZUNA_APP_ID = os.environ.get("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.environ.get("ADZUNA_APP_KEY", "")

# SimplifyJobs GitHub source
SIMPLIFY_URL = "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json"

# API rate limiting
LEVER_RATE_LIMIT_DELAY = 0.5  # seconds between requests (2 req/sec limit)

# Request timeouts
REQUEST_TIMEOUT = 30  # seconds
