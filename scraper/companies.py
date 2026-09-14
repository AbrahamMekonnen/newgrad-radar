"""Company list with ATS mappings for job scraping."""

COMPANIES = {
    # FAANG
    "meta": {"name": "Meta", "tier": "faang", "ats_type": "custom", "ats_token": None},
    "apple": {"name": "Apple", "tier": "faang", "ats_type": "custom", "ats_token": None},
    "amazon": {"name": "Amazon", "tier": "faang", "ats_type": "custom", "ats_token": None},
    "netflix": {"name": "Netflix", "tier": "faang", "ats_type": "lever", "ats_token": "netflix"},
    "google": {"name": "Google", "tier": "faang", "ats_type": "custom", "ats_token": None},
    "microsoft": {"name": "Microsoft", "tier": "faang", "ats_type": "custom", "ats_token": None},
    "nvidia": {"name": "Nvidia", "tier": "faang", "ats_type": "workday", "ats_token": None},

    # Hot AI
    "anthropic": {"name": "Anthropic", "tier": "ai", "ats_type": "greenhouse", "ats_token": "anthropic"},
    "openai": {"name": "OpenAI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "openai"},
    "coreweave": {"name": "CoreWeave", "tier": "ai", "ats_type": "greenhouse", "ats_token": "coreweave"},
    "together-ai": {"name": "Together AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "togetherai"},
    "anyscale": {"name": "Anyscale", "tier": "ai", "ats_type": "greenhouse", "ats_token": "anyscale"},
    "modal": {"name": "Modal", "tier": "ai", "ats_type": "greenhouse", "ats_token": "modal-labs"},
    "fireworks-ai": {"name": "Fireworks AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "fireworks-ai"},
    "groq": {"name": "Groq", "tier": "ai", "ats_type": "greenhouse", "ats_token": "groq"},
    "mistral": {"name": "Mistral AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "mistral"},
    "perplexity": {"name": "Perplexity", "tier": "ai", "ats_type": "greenhouse", "ats_token": "perplexity"},
    "cursor": {"name": "Cursor", "tier": "ai", "ats_type": "greenhouse", "ats_token": "anysphere"},
    "replit": {"name": "Replit", "tier": "ai", "ats_type": "lever", "ats_token": "replit"},
    "sourcegraph": {"name": "Sourcegraph", "tier": "ai", "ats_type": "greenhouse", "ats_token": "sourcegraph"},
    "tabnine": {"name": "Tabnine", "tier": "ai", "ats_type": "greenhouse", "ats_token": "tabnine"},
    "character-ai": {"name": "Character AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "character"},
    "inflection": {"name": "Inflection AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "inflection"},
    "adept": {"name": "Adept", "tier": "ai", "ats_type": "greenhouse", "ats_token": "adept-ai"},
    "runway": {"name": "Runway", "tier": "ai", "ats_type": "lever", "ats_token": "runwayml"},
    "midjourney": {"name": "Midjourney", "tier": "ai", "ats_type": "custom", "ats_token": None},
    "stability-ai": {"name": "Stability AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "stability-ai"},
    "descript": {"name": "Descript", "tier": "ai", "ats_type": "greenhouse", "ats_token": "descript"},
    "jasper": {"name": "Jasper", "tier": "ai", "ats_type": "greenhouse", "ats_token": "jasper-ai"},
    "copy-ai": {"name": "Copy.ai", "tier": "ai", "ats_type": "lever", "ats_token": "copy-ai"},
    "writer": {"name": "Writer", "tier": "ai", "ats_type": "greenhouse", "ats_token": "writer"},
    "coframe": {"name": "Coframe", "tier": "ai", "ats_type": "ashby", "ats_token": "coframe"},
    "weights-biases": {"name": "Weights & Biases", "tier": "ai", "ats_type": "greenhouse", "ats_token": "wandb"},
    "pinecone": {"name": "Pinecone", "tier": "ai", "ats_type": "greenhouse", "ats_token": "pinecone"},
    "weaviate": {"name": "Weaviate", "tier": "ai", "ats_type": "greenhouse", "ats_token": "weaviate"},
    "langchain": {"name": "LangChain", "tier": "ai", "ats_type": "ashby", "ats_token": "langchain"},
    "eleven-labs": {"name": "Eleven Labs", "tier": "ai", "ats_type": "ashby", "ats_token": "elevenlabs"},
    "suno": {"name": "Suno", "tier": "ai", "ats_type": "ashby", "ats_token": "suno"},
    "pika": {"name": "Pika", "tier": "ai", "ats_type": "greenhouse", "ats_token": "pika-labs"},
    "luma-ai": {"name": "Luma AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "lumalabs"},
    "harvey-ai": {"name": "Harvey AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "harvey"},
    "glean": {"name": "Glean", "tier": "ai", "ats_type": "greenhouse", "ats_token": "glean"},
    "hebbia": {"name": "Hebbia", "tier": "ai", "ats_type": "greenhouse", "ats_token": "hebbia"},
    "sierra-ai": {"name": "Sierra AI", "tier": "ai", "ats_type": "greenhouse", "ats_token": "sierra-ai"},
    "cohere": {"name": "Cohere", "tier": "ai", "ats_type": "greenhouse", "ats_token": "cohere"},
    "huggingface": {"name": "Hugging Face", "tier": "ai", "ats_type": "greenhouse", "ats_token": "huggingface"},
    "replicate": {"name": "Replicate", "tier": "ai", "ats_type": "ashby", "ats_token": "replicate"},

    # Unicorns
    "stripe": {"name": "Stripe", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "stripe"},
    "databricks": {"name": "Databricks", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "databricks"},
    "figma": {"name": "Figma", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "figma"},
    "notion": {"name": "Notion", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "notion"},
    "canva": {"name": "Canva", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "canva"},
    "discord": {"name": "Discord", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "discord"},
    "reddit": {"name": "Reddit", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "reddit"},
    "instacart": {"name": "Instacart", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "instacart"},
    "doordash": {"name": "DoorDash", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "doordash"},
    "coinbase": {"name": "Coinbase", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "coinbase"},
    "robinhood": {"name": "Robinhood", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "robinhood"},
    "plaid": {"name": "Plaid", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "plaid"},
    "ramp": {"name": "Ramp", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "ramp"},
    "brex": {"name": "Brex", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "brex"},
    "airtable": {"name": "Airtable", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "airtable"},
    "clickup": {"name": "ClickUp", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "clickup"},
    "linear": {"name": "Linear", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "linear"},
    "vercel": {"name": "Vercel", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "vercel"},
    "supabase": {"name": "Supabase", "tier": "unicorn", "ats_type": "ashby", "ats_token": "supabase"},
    "retool": {"name": "Retool", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "retool"},
    "webflow": {"name": "Webflow", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "webflow"},
    "scale-ai": {"name": "Scale AI", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "scaleai"},
    "rippling": {"name": "Rippling", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "rippling"},
    "flexport": {"name": "Flexport", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "flexport"},
    "navan": {"name": "Navan", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "navan"},
    "grammarly": {"name": "Grammarly", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "grammarly"},
    "miro": {"name": "Miro", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "miro"},
    "asana": {"name": "Asana", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "asana"},
    "amplitude": {"name": "Amplitude", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "amplitude"},
    "datadog": {"name": "Datadog", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "datadog"},
    "snowflake": {"name": "Snowflake", "tier": "unicorn", "ats_type": "workday", "ats_token": None},
    "cloudflare": {"name": "Cloudflare", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "cloudflare"},
    "palantir": {"name": "Palantir", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "palantir"},

    # YC Notable
    "airbnb": {"name": "Airbnb", "tier": "yc", "ats_type": "greenhouse", "ats_token": "airbnb"},
    "dropbox": {"name": "Dropbox", "tier": "yc", "ats_type": "greenhouse", "ats_token": "dropbox"},
    "twitch": {"name": "Twitch", "tier": "yc", "ats_type": "greenhouse", "ats_token": "twitch"},
    "cruise": {"name": "Cruise", "tier": "yc", "ats_type": "greenhouse", "ats_token": "cruise"},
    "faire": {"name": "Faire", "tier": "yc", "ats_type": "greenhouse", "ats_token": "faire"},
    "ginkgo": {"name": "Ginkgo Bioworks", "tier": "yc", "ats_type": "greenhouse", "ats_token": "ginkgobioworks"},
    "rappi": {"name": "Rappi", "tier": "yc", "ats_type": "lever", "ats_token": "rappi"},
    "meesho": {"name": "Meesho", "tier": "yc", "ats_type": "lever", "ats_token": "meesho"},
    "razorpay": {"name": "Razorpay", "tier": "yc", "ats_type": "lever", "ats_token": "razorpay"},
    "gusto": {"name": "Gusto", "tier": "yc", "ats_type": "greenhouse", "ats_token": "gusto"},
    "checkr": {"name": "Checkr", "tier": "yc", "ats_type": "greenhouse", "ats_token": "checkr"},
    "weave": {"name": "Weave", "tier": "yc", "ats_type": "greenhouse", "ats_token": "getweave"},
    "deel": {"name": "Deel", "tier": "yc", "ats_type": "ashby", "ats_token": "deel"},
    "lattice": {"name": "Lattice", "tier": "yc", "ats_type": "greenhouse", "ats_token": "lattice"},
    "ironclad": {"name": "Ironclad", "tier": "yc", "ats_type": "greenhouse", "ats_token": "ironclad"},
    "vanta": {"name": "Vanta", "tier": "yc", "ats_type": "greenhouse", "ats_token": "vanta"},
    "mercury": {"name": "Mercury", "tier": "yc", "ats_type": "greenhouse", "ats_token": "mercury"},
    "opensea": {"name": "OpenSea", "tier": "yc", "ats_type": "greenhouse", "ats_token": "opensea"},
    "fleek": {"name": "Fleek", "tier": "yc", "ats_type": "lever", "ats_token": "fleek"},

    # Fintech
    "affirm": {"name": "Affirm", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "affirm"},
    "klarna": {"name": "Klarna", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "klarna"},
    "chime": {"name": "Chime", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "chime"},
    "sofi": {"name": "SoFi", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "sofi"},
    "marqeta": {"name": "Marqeta", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "marqeta"},

    # Infra / Dev Tools
    "hashicorp": {"name": "HashiCorp", "tier": "infra", "ats_type": "greenhouse", "ats_token": "hashicorp"},
    "confluent": {"name": "Confluent", "tier": "infra", "ats_type": "greenhouse", "ats_token": "confluent"},
    "mongodb": {"name": "MongoDB", "tier": "infra", "ats_type": "greenhouse", "ats_token": "mongodb"},
    "planetscale": {"name": "PlanetScale", "tier": "infra", "ats_type": "ashby", "ats_token": "planetscale"},
    "neon": {"name": "Neon", "tier": "infra", "ats_type": "ashby", "ats_token": "neondatabase"},
    "turso": {"name": "Turso", "tier": "infra", "ats_type": "ashby", "ats_token": "turso"},

    # --- Expanded company list (validated live against ATS APIs, US-focused) ---
    # Greenhouse
    "waymo": {"name": "Waymo", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "waymo"},
    "okta": {"name": "Okta", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "okta"},
    "verkada": {"name": "Verkada", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "verkada"},
    "samsara": {"name": "Samsara", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "samsara"},
    "roblox": {"name": "Roblox", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "roblox"},
    "gitlab": {"name": "GitLab", "tier": "infra", "ats_type": "greenhouse", "ats_token": "gitlab"},
    "lyft": {"name": "Lyft", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "lyft"},
    "pinterest": {"name": "Pinterest", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "pinterest"},
    "twilio": {"name": "Twilio", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "twilio"},
    "nuro": {"name": "Nuro", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "nuro"},
    "mixpanel": {"name": "Mixpanel", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "mixpanel"},
    "abnormalsecurity": {"name": "Abnormal Security", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "abnormalsecurity"},
    "carta": {"name": "Carta", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "carta"},
    "tanium": {"name": "Tanium", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "tanium"},
    "betterment": {"name": "Betterment", "tier": "fintech", "ats_type": "greenhouse", "ats_token": "betterment"},
    "cockroachlabs": {"name": "Cockroach Labs", "tier": "infra", "ats_type": "greenhouse", "ats_token": "cockroachlabs"},
    "nextdoor": {"name": "Nextdoor", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "nextdoor"},
    "labelbox": {"name": "Labelbox", "tier": "ai", "ats_type": "greenhouse", "ats_token": "labelbox"},
    "motive": {"name": "Motive", "tier": "unicorn", "ats_type": "greenhouse", "ats_token": "motive"},
    # Lever
    "angellist": {"name": "AngelList", "tier": "unicorn", "ats_type": "lever", "ats_token": "angellist"},
    "gopuff": {"name": "Gopuff", "tier": "unicorn", "ats_type": "lever", "ats_token": "gopuff"},
    "spotify": {"name": "Spotify", "tier": "unicorn", "ats_type": "lever", "ats_token": "spotify"},
    "palantir": {"name": "Palantir", "tier": "unicorn", "ats_type": "lever", "ats_token": "palantir"},
    "shieldai": {"name": "Shield AI", "tier": "ai", "ats_type": "lever", "ats_token": "shieldai"},
    "matchgroup": {"name": "Match Group", "tier": "unicorn", "ats_type": "lever", "ats_token": "matchgroup"},
    # Ashby
    "baseten": {"name": "Baseten", "tier": "ai", "ats_type": "ashby", "ats_token": "baseten"},
    "fireworks": {"name": "Fireworks AI", "tier": "ai", "ats_type": "ashby", "ats_token": "fireworks"},
    "watershed": {"name": "Watershed", "tier": "unicorn", "ats_type": "ashby", "ats_token": "watershed"},
    "hex": {"name": "Hex", "tier": "infra", "ats_type": "ashby", "ats_token": "hex"},
    "airbyte": {"name": "Airbyte", "tier": "infra", "ats_type": "ashby", "ats_token": "airbyte"},
    "temporal": {"name": "Temporal", "tier": "infra", "ats_type": "ashby", "ats_token": "temporal"},
    "render": {"name": "Render", "tier": "infra", "ats_type": "ashby", "ats_token": "render"},
    "railway": {"name": "Railway", "tier": "yc", "ats_type": "ashby", "ats_token": "railway"},
    "resend": {"name": "Resend", "tier": "yc", "ats_type": "ashby", "ats_token": "resend"},
    "sardine": {"name": "Sardine", "tier": "fintech", "ats_type": "ashby", "ats_token": "sardine"},
    "column": {"name": "Column", "tier": "fintech", "ats_type": "ashby", "ats_token": "column"},
    "middesk": {"name": "Middesk", "tier": "yc", "ats_type": "ashby", "ats_token": "middesk"},
    "persona": {"name": "Persona", "tier": "unicorn", "ats_type": "ashby", "ats_token": "persona"},
    "browserbase": {"name": "Browserbase", "tier": "yc", "ats_type": "ashby", "ats_token": "browserbase"},
}


def get_companies_by_tier(tier: str) -> dict:
    """Get all companies in a specific tier."""
    return {k: v for k, v in COMPANIES.items() if v["tier"] == tier}


def get_companies_by_ats(ats_type: str) -> dict:
    """Get all companies using a specific ATS type."""
    return {k: v for k, v in COMPANIES.items() if v["ats_type"] == ats_type}


def get_greenhouse_companies() -> dict:
    """Get all companies using Greenhouse ATS."""
    return get_companies_by_ats("greenhouse")


def get_lever_companies() -> dict:
    """Get all companies using Lever ATS."""
    return get_companies_by_ats("lever")


def get_ashby_companies() -> dict:
    """Get all companies using Ashby ATS."""
    return get_companies_by_ats("ashby")


# Build lookup tables for company name normalization
COMPANY_NAME_TO_SLUG = {}
COMPANY_TOKEN_TO_SLUG = {}

for slug, info in COMPANIES.items():
    # Map display name to slug
    COMPANY_NAME_TO_SLUG[info["name"].lower()] = slug
    # Map ATS token to slug
    if info["ats_token"]:
        COMPANY_TOKEN_TO_SLUG[info["ats_token"].lower()] = slug
