# Target Companies

## Overview

~113 target companies across 6 tiers. Each company has:
- **slug**: Unique identifier (lowercase, hyphenated)
- **name**: Display name
- **tier**: Category (faang, ai, unicorn, yc, fintech, infra)
- **ats_type**: Applicant tracking system (greenhouse, lever, ashby, workday, custom)
- **ats_token**: Board token for API calls

## Tiers

| Tier | Count | Description |
|------|-------|-------------|
| `faang` | 7 | Big tech (Meta, Apple, Amazon, Netflix, Google, Microsoft, Nvidia) |
| `ai` | 40 | AI/ML companies (Anthropic, OpenAI, etc.) |
| `unicorn` | 35 | $1B+ startups (Stripe, Figma, etc.) |
| `yc` | 19 | Notable YC companies |
| `fintech` | 5 | Financial technology |
| `infra` | 6 | Infrastructure / Dev Tools |

## ATS Types

| ATS | API | Auth | Companies |
|-----|-----|------|-----------|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | None | ~50 |
| Lever | `api.lever.co/v0/postings/{slug}` | None | ~20 |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{token}` | None | ~10 |
| Workday | Custom per company (requires scraping) | N/A | ~5 |
| Custom | Company-specific career pages | N/A | ~28 |

## Company List

### FAANG (7)

| Slug | Name | ATS | Token |
|------|------|-----|-------|
| `meta` | Meta | Custom | - |
| `apple` | Apple | Custom | - |
| `amazon` | Amazon | Custom | - |
| `netflix` | Netflix | Lever | `netflix` |
| `google` | Google | Custom | - |
| `microsoft` | Microsoft | Custom | - |
| `nvidia` | Nvidia | Workday | - |

### Hot AI (40)

| Slug | Name | ATS | Token |
|------|------|-----|-------|
| `anthropic` | Anthropic | Greenhouse | `anthropic` |
| `openai` | OpenAI | Greenhouse | `openai` |
| `coreweave` | CoreWeave | Greenhouse | `coreweave` |
| `together-ai` | Together AI | Greenhouse | `togetherai` |
| `anyscale` | Anyscale | Greenhouse | `anyscale` |
| `modal` | Modal | Greenhouse | `modal-labs` |
| `fireworks-ai` | Fireworks AI | Greenhouse | `fireworks-ai` |
| `groq` | Groq | Greenhouse | `groq` |
| `mistral` | Mistral AI | Greenhouse | `mistral` |
| `perplexity` | Perplexity | Greenhouse | `perplexity` |
| `cursor` | Cursor | Greenhouse | `anysphere` |
| `replit` | Replit | Lever | `replit` |
| `sourcegraph` | Sourcegraph | Greenhouse | `sourcegraph` |
| `tabnine` | Tabnine | Greenhouse | `tabnine` |
| `character-ai` | Character AI | Greenhouse | `character` |
| `inflection` | Inflection AI | Greenhouse | `inflection` |
| `adept` | Adept | Greenhouse | `adept-ai` |
| `runway` | Runway | Lever | `runwayml` |
| `midjourney` | Midjourney | Custom | - |
| `stability-ai` | Stability AI | Greenhouse | `stability-ai` |
| `descript` | Descript | Greenhouse | `descript` |
| `jasper` | Jasper | Greenhouse | `jasper-ai` |
| `copy-ai` | Copy.ai | Lever | `copy-ai` |
| `writer` | Writer | Greenhouse | `writer` |
| `coframe` | Coframe | Ashby | `coframe` |
| `weights-biases` | Weights & Biases | Greenhouse | `wandb` |
| `pinecone` | Pinecone | Greenhouse | `pinecone` |
| `weaviate` | Weaviate | Greenhouse | `weaviate` |
| `langchain` | LangChain | Ashby | `langchain` |
| `eleven-labs` | Eleven Labs | Ashby | `elevenlabs` |
| `suno` | Suno | Ashby | `suno` |
| `pika` | Pika | Greenhouse | `pika-labs` |
| `luma-ai` | Luma AI | Greenhouse | `lumalabs` |
| `harvey-ai` | Harvey AI | Greenhouse | `harvey` |
| `glean` | Glean | Greenhouse | `glean` |
| `hebbia` | Hebbia | Greenhouse | `hebbia` |
| `sierra-ai` | Sierra AI | Greenhouse | `sierra-ai` |
| `cohere` | Cohere | Greenhouse | `cohere` |
| `huggingface` | Hugging Face | Greenhouse | `huggingface` |
| `replicate` | Replicate | Ashby | `replicate` |

### Unicorns (35)

| Slug | Name | ATS | Token |
|------|------|-----|-------|
| `stripe` | Stripe | Greenhouse | `stripe` |
| `databricks` | Databricks | Greenhouse | `databricks` |
| `figma` | Figma | Greenhouse | `figma` |
| `notion` | Notion | Greenhouse | `notion` |
| `canva` | Canva | Greenhouse | `canva` |
| `discord` | Discord | Greenhouse | `discord` |
| `reddit` | Reddit | Greenhouse | `reddit` |
| `instacart` | Instacart | Greenhouse | `instacart` |
| `doordash` | DoorDash | Greenhouse | `doordash` |
| `coinbase` | Coinbase | Greenhouse | `coinbase` |
| `robinhood` | Robinhood | Greenhouse | `robinhood` |
| `plaid` | Plaid | Greenhouse | `plaid` |
| `ramp` | Ramp | Greenhouse | `ramp` |
| `brex` | Brex | Greenhouse | `brex` |
| `airtable` | Airtable | Greenhouse | `airtable` |
| `clickup` | ClickUp | Greenhouse | `clickup` |
| `linear` | Linear | Greenhouse | `linear` |
| `vercel` | Vercel | Greenhouse | `vercel` |
| `supabase` | Supabase | Ashby | `supabase` |
| `retool` | Retool | Greenhouse | `retool` |
| `webflow` | Webflow | Greenhouse | `webflow` |
| `scale-ai` | Scale AI | Greenhouse | `scaleai` |
| `rippling` | Rippling | Greenhouse | `rippling` |
| `flexport` | Flexport | Greenhouse | `flexport` |
| `navan` | Navan | Greenhouse | `navan` |
| `grammarly` | Grammarly | Greenhouse | `grammarly` |
| `miro` | Miro | Greenhouse | `miro` |
| `asana` | Asana | Greenhouse | `asana` |
| `amplitude` | Amplitude | Greenhouse | `amplitude` |
| `datadog` | Datadog | Greenhouse | `datadog` |
| `snowflake` | Snowflake | Workday | - |
| `cloudflare` | Cloudflare | Greenhouse | `cloudflare` |
| `palantir` | Palantir | Greenhouse | `palantir` |

### YC Notable (19)

| Slug | Name | ATS | Token |
|------|------|-----|-------|
| `airbnb` | Airbnb | Greenhouse | `airbnb` |
| `dropbox` | Dropbox | Greenhouse | `dropbox` |
| `twitch` | Twitch | Greenhouse | `twitch` |
| `cruise` | Cruise | Greenhouse | `cruise` |
| `faire` | Faire | Greenhouse | `faire` |
| `ginkgo` | Ginkgo Bioworks | Greenhouse | `ginkgobioworks` |
| `rappi` | Rappi | Lever | `rappi` |
| `meesho` | Meesho | Lever | `meesho` |
| `razorpay` | Razorpay | Lever | `razorpay` |
| `gusto` | Gusto | Greenhouse | `gusto` |
| `checkr` | Checkr | Greenhouse | `checkr` |
| `weave` | Weave | Greenhouse | `getweave` |
| `deel` | Deel | Ashby | `deel` |
| `lattice` | Lattice | Greenhouse | `lattice` |
| `ironclad` | Ironclad | Greenhouse | `ironclad` |
| `vanta` | Vanta | Greenhouse | `vanta` |
| `mercury` | Mercury | Greenhouse | `mercury` |
| `opensea` | OpenSea | Greenhouse | `opensea` |
| `fleek` | Fleek | Lever | `fleek` |

### Fintech (5)

| Slug | Name | ATS | Token |
|------|------|-----|-------|
| `affirm` | Affirm | Greenhouse | `affirm` |
| `klarna` | Klarna | Greenhouse | `klarna` |
| `chime` | Chime | Greenhouse | `chime` |
| `sofi` | SoFi | Greenhouse | `sofi` |
| `marqeta` | Marqeta | Greenhouse | `marqeta` |

### Infra / Dev Tools (6)

| Slug | Name | ATS | Token |
|------|------|-----|-------|
| `hashicorp` | HashiCorp | Greenhouse | `hashicorp` |
| `confluent` | Confluent | Greenhouse | `confluent` |
| `mongodb` | MongoDB | Greenhouse | `mongodb` |
| `planetscale` | PlanetScale | Ashby | `planetscale` |
| `neon` | Neon | Ashby | `neondatabase` |
| `turso` | Turso | Ashby | `turso` |

## Python Dictionary

Use this in `scraper/companies.py`:

```python
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
}

# Helper functions
def get_companies_by_tier(tier: str) -> dict:
    return {k: v for k, v in COMPANIES.items() if v["tier"] == tier}

def get_companies_by_ats(ats_type: str) -> dict:
    return {k: v for k, v in COMPANIES.items() if v["ats_type"] == ats_type}

def get_greenhouse_companies() -> dict:
    return get_companies_by_ats("greenhouse")

def get_lever_companies() -> dict:
    return get_companies_by_ats("lever")

def get_ashby_companies() -> dict:
    return get_companies_by_ats("ashby")
```

## SQL Seed Data

Insert companies into Supabase:

```sql
INSERT INTO companies (slug, name, tier, ats_type, ats_token) VALUES
-- FAANG
('meta', 'Meta', 'faang', 'custom', NULL),
('apple', 'Apple', 'faang', 'custom', NULL),
('amazon', 'Amazon', 'faang', 'custom', NULL),
('netflix', 'Netflix', 'faang', 'lever', 'netflix'),
('google', 'Google', 'faang', 'custom', NULL),
('microsoft', 'Microsoft', 'faang', 'custom', NULL),
('nvidia', 'Nvidia', 'faang', 'workday', NULL),

-- Hot AI (sample - add all 40)
('anthropic', 'Anthropic', 'ai', 'greenhouse', 'anthropic'),
('openai', 'OpenAI', 'ai', 'greenhouse', 'openai'),
('coreweave', 'CoreWeave', 'ai', 'greenhouse', 'coreweave'),
('together-ai', 'Together AI', 'ai', 'greenhouse', 'togetherai'),
('perplexity', 'Perplexity', 'ai', 'greenhouse', 'perplexity'),
('cursor', 'Cursor', 'ai', 'greenhouse', 'anysphere'),

-- Unicorns (sample - add all 35)
('stripe', 'Stripe', 'unicorn', 'greenhouse', 'stripe'),
('figma', 'Figma', 'unicorn', 'greenhouse', 'figma'),
('notion', 'Notion', 'unicorn', 'greenhouse', 'notion'),
('discord', 'Discord', 'unicorn', 'greenhouse', 'discord'),
('vercel', 'Vercel', 'unicorn', 'greenhouse', 'vercel'),

-- Add rest of companies...
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tier = EXCLUDED.tier,
  ats_type = EXCLUDED.ats_type,
  ats_token = EXCLUDED.ats_token;
```

## Adding New Companies

1. Find the company's career page
2. Identify their ATS (check URL patterns):
   - `boards.greenhouse.io/{token}` → Greenhouse
   - `jobs.lever.co/{slug}` → Lever
   - `jobs.ashbyhq.com/{token}` → Ashby
   - `*.wd5.myworkdayjobs.com` → Workday
3. Add to `COMPANIES` dict in `scraper/companies.py`
4. Add to `companies` table in Supabase
5. Test: `curl https://boards-api.greenhouse.io/v1/boards/{token}/jobs | head`

## Notes

- **ATS tokens are case-sensitive** - verify by testing the API
- **Some tokens differ from company names** - e.g., Cursor uses `anysphere`
- **Custom/Workday companies** rely on SimplifyJobs as the source
- **Logos** can be fetched from Clearbit: `https://logo.clearbit.com/{domain}`
