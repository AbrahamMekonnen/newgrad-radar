#!/bin/bash
# Start the auto-apply worker

cd "$(dirname "$0")"

# Load environment variables
if [ -f "../.env.local" ]; then
  export $(cat ../.env.local | grep -v '^#' | xargs)
fi

# Check for required env vars
if [ -z "$SUPABASE_SERVICE_KEY" ] && [ -z "$SUPABASE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_KEY or SUPABASE_KEY must be set"
  exit 1
fi

# Activate virtual environment if it exists
if [ -d "v2/venv" ]; then
  source v2/venv/bin/activate
fi

echo "Starting auto-apply worker..."
python worker.py
