#!/bin/bash
# NewGrad Radar Auto-Apply v2 Setup

echo "Setting up Auto-Apply v2 (browser-use + Gemini)..."

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install playwright browsers
playwright install chromium

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Create a .env file with your Gemini API key:"
echo "   echo 'GOOGLE_API_KEY=your_key_here' > .env"
echo ""
echo "2. Edit profile.yaml with your info"
echo ""
echo "3. Run:"
echo "   python agent.py --url 'https://boards.greenhouse.io/company/jobs/12345'"
