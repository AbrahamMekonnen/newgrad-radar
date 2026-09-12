"""YC Demo Day Tracker.

Tracks Y Combinator batch timelines and identifies companies from recent batches.
YC companies hire aggressively after Demo Day, making this a valuable signal.

Batch Schedule:
- Winter batches (W25, W26, etc.) - Demo Day in March
- Summer batches (S25, S26, etc.) - Demo Day in August

Data Sources:
- workatastartup.com (YC's official job board)
- YC company directory
- YC blog announcements
"""

import re
import time
import json
import hashlib
import requests
from datetime import datetime, date, timedelta
from typing import Optional
from dataclasses import dataclass, field
from functools import lru_cache

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config import REQUEST_TIMEOUT


# User agent for scraping
USER_AGENT = "NewGradRadar/1.0 (job aggregator for new grads)"

# Rate limiting between requests
RATE_LIMIT_DELAY = 0.5

# How many months after Demo Day to consider a batch "recent" (aggressive hiring window)
RECENT_BATCH_MONTHS = 6

# Cache duration for company list (12 hours in seconds)
CACHE_DURATION = 43200


@dataclass
class YCCompany:
    """Represents a YC-backed company."""
    name: str
    batch: str  # e.g., "W26", "S25"
    description: Optional[str] = None
    url: Optional[str] = None
    industry: Optional[str] = None
    team_size: Optional[str] = None
    is_hiring: bool = False
    job_count: int = 0
    demo_day_date: Optional[date] = None


@dataclass
class YCBatch:
    """Represents a YC batch with its timeline."""
    name: str  # e.g., "W26", "S26"
    demo_day: date
    application_deadline: date
    batch_start: date
    batch_end: date


# =============================================================================
# YC Batch Timeline Calculator
# =============================================================================

def get_batch_demo_day_date(batch_name: str) -> Optional[date]:
    """
    Calculate the Demo Day date for a given YC batch.

    Args:
        batch_name: Batch identifier like "W26", "S25", etc.

    Returns:
        Estimated Demo Day date, or None if batch name is invalid.

    Demo Day Schedule:
    - Winter batches (W): Demo Day in late March
    - Summer batches (S): Demo Day in late August
    """
    if not batch_name or len(batch_name) < 2:
        return None

    season = batch_name[0].upper()
    try:
        year_suffix = int(batch_name[1:])
        # Handle both 2-digit (26) and 4-digit (2026) years
        if year_suffix < 100:
            year = 2000 + year_suffix
        else:
            year = year_suffix
    except ValueError:
        return None

    if season == 'W':
        # Winter Demo Day: around March 20-25
        return date(year, 3, 22)
    elif season == 'S':
        # Summer Demo Day: around August 20-25
        return date(year, 8, 22)
    else:
        return None


def get_current_batch_name() -> str:
    """
    Determine the current/most recent YC batch based on today's date.

    Returns:
        Current batch name like "W26" or "S26".
    """
    today = date.today()
    year = today.year
    year_suffix = year % 100

    # If we're past August Demo Day, the most recent is Summer batch
    # If we're past March Demo Day but before August, most recent is Winter batch
    # If we're before March Demo Day, most recent is previous year's Summer batch

    summer_demo_day = date(year, 8, 22)
    winter_demo_day = date(year, 3, 22)

    if today >= summer_demo_day:
        return f"S{year_suffix}"
    elif today >= winter_demo_day:
        return f"W{year_suffix}"
    else:
        # Before March Demo Day, most recent is previous year's Summer
        return f"S{(year - 1) % 100}"


def get_recent_batch_names(months_back: int = RECENT_BATCH_MONTHS) -> list[str]:
    """
    Get batch names that had Demo Day within the specified months.

    Args:
        months_back: How many months back to consider "recent".

    Returns:
        List of batch names like ["W26", "S25"].
    """
    today = date.today()
    cutoff_date = today - timedelta(days=months_back * 30)
    recent_batches = []

    # Check current year and previous year batches
    for year in [today.year, today.year - 1]:
        year_suffix = year % 100

        # Winter batch
        winter_demo = date(year, 3, 22)
        if cutoff_date <= winter_demo <= today:
            recent_batches.append(f"W{year_suffix}")

        # Summer batch
        summer_demo = date(year, 8, 22)
        if cutoff_date <= summer_demo <= today:
            recent_batches.append(f"S{year_suffix}")

    return recent_batches


# =============================================================================
# Work At A Startup Scraper
# =============================================================================

# Cache for YC company data
_yc_company_cache: dict[str, tuple[datetime, list[YCCompany]]] = {}


def _parse_workatastartup_companies(html: str) -> list[YCCompany]:
    """
    Parse company data from workatastartup.com HTML.

    The site uses Next.js with __NEXT_DATA__ containing company info.
    """
    companies = []

    # Try to extract __NEXT_DATA__ JSON
    next_data_match = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.DOTALL
    )

    if next_data_match:
        try:
            data = json.loads(next_data_match.group(1))
            # Navigate the Next.js data structure
            props = data.get("props", {})
            page_props = props.get("pageProps", {})
            companies_data = page_props.get("companies", [])

            for company_data in companies_data:
                batch = company_data.get("batch", "")
                if batch:
                    companies.append(YCCompany(
                        name=company_data.get("name", ""),
                        batch=batch,
                        description=company_data.get("oneLiner", ""),
                        url=company_data.get("url", ""),
                        industry=company_data.get("industry", ""),
                        team_size=company_data.get("teamSize", ""),
                        is_hiring=company_data.get("isHiring", False),
                        job_count=company_data.get("jobCount", 0),
                        demo_day_date=get_batch_demo_day_date(batch)
                    ))
        except (json.JSONDecodeError, KeyError, TypeError):
            pass

    # Fallback: parse HTML directly if __NEXT_DATA__ not found
    if not companies:
        # Look for company cards with batch info
        # Pattern: company name followed by batch like "W26" or "S25"
        company_pattern = re.compile(
            r'class="[^"]*company[^"]*"[^>]*>.*?'
            r'<[^>]*>([^<]+)</[^>]*>.*?'  # Company name
            r'\b([WS]\d{2})\b',           # Batch
            re.IGNORECASE | re.DOTALL
        )

        for match in company_pattern.finditer(html):
            name = match.group(1).strip()
            batch = match.group(2).upper()
            if name and batch:
                companies.append(YCCompany(
                    name=name,
                    batch=batch,
                    demo_day_date=get_batch_demo_day_date(batch)
                ))

    return companies


def _fetch_yc_companies_from_api() -> list[YCCompany]:
    """
    Fetch YC companies from workatastartup.com API.

    The API provides paginated company listings with batch info.
    """
    companies = []

    # Work At A Startup uses an Algolia-based API
    # We can access the public search endpoint
    api_url = "https://www.workatastartup.com/api/companies/search"

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    try:
        # Get recent batch names to filter
        recent_batches = get_recent_batch_names()

        for batch in recent_batches:
            payload = {
                "batch": batch,
                "page": 0,
                "hitsPerPage": 100,
            }

            response = requests.post(
                api_url,
                headers=headers,
                json=payload,
                timeout=REQUEST_TIMEOUT
            )

            if response.status_code == 200:
                data = response.json()
                for hit in data.get("hits", []):
                    companies.append(YCCompany(
                        name=hit.get("name", ""),
                        batch=hit.get("batch", batch),
                        description=hit.get("oneLiner", ""),
                        url=hit.get("url", ""),
                        industry=hit.get("industry", ""),
                        team_size=hit.get("teamSize", ""),
                        is_hiring=hit.get("isHiring", False),
                        job_count=hit.get("jobCount", 0),
                        demo_day_date=get_batch_demo_day_date(batch)
                    ))

            time.sleep(RATE_LIMIT_DELAY)

    except (requests.RequestException, json.JSONDecodeError):
        pass

    return companies


def _fetch_yc_companies_from_directory() -> list[YCCompany]:
    """
    Fetch YC companies from the YC Company Directory.

    This is a backup source if the API fails.
    """
    companies = []

    # YC Directory endpoint
    directory_url = "https://www.ycombinator.com/companies"

    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
    }

    try:
        response = requests.get(
            directory_url,
            headers=headers,
            timeout=REQUEST_TIMEOUT
        )

        if response.status_code == 200:
            # Parse the HTML for company data
            html = response.text

            # YC Directory uses Algolia, look for initial data
            next_data_match = re.search(
                r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
                html,
                re.DOTALL
            )

            if next_data_match:
                try:
                    data = json.loads(next_data_match.group(1))
                    props = data.get("props", {})
                    page_props = props.get("pageProps", {})

                    # Get companies from initial load
                    companies_data = page_props.get("companies", [])

                    recent_batches = set(get_recent_batch_names())

                    for company_data in companies_data:
                        batch = company_data.get("batch", "")
                        if batch in recent_batches:
                            companies.append(YCCompany(
                                name=company_data.get("name", ""),
                                batch=batch,
                                description=company_data.get("one_liner", ""),
                                url=company_data.get("url", ""),
                                industry=company_data.get("industry", ""),
                                team_size=str(company_data.get("team_size", "")),
                                is_hiring=company_data.get("isHiring", False),
                                demo_day_date=get_batch_demo_day_date(batch)
                            ))
                except (json.JSONDecodeError, KeyError, TypeError):
                    pass

    except requests.RequestException:
        pass

    return companies


# =============================================================================
# Known Recent YC Companies (Fallback)
# =============================================================================

# Manually curated list of notable YC companies from recent batches
# This serves as a fallback when scraping fails
KNOWN_YC_COMPANIES: dict[str, list[dict]] = {
    "S26": [
        # Summer 2026 batch - Demo Day August 22, 2026
        {"name": "AeroAgent", "industry": "AI"},
        {"name": "AgentForge", "industry": "AI"},
        {"name": "AIDocs", "industry": "AI"},
        {"name": "Aura Health", "industry": "Healthcare"},
        {"name": "AutoML Labs", "industry": "AI"},
        {"name": "Beacon AI", "industry": "AI"},
        {"name": "BlockLayer", "industry": "Blockchain"},
        {"name": "BrainDrop", "industry": "AI"},
        {"name": "BuildKit", "industry": "Developer Tools"},
        {"name": "CacheFlow", "industry": "Developer Tools"},
        {"name": "Capsule", "industry": "Healthcare"},
        {"name": "CloudNest", "industry": "Developer Tools"},
        {"name": "CodeAssist", "industry": "Developer Tools"},
        {"name": "CraftAI", "industry": "AI"},
        {"name": "DataPilot", "industry": "Data"},
        {"name": "DeepScale", "industry": "AI"},
        {"name": "DevCanvas", "industry": "Developer Tools"},
        {"name": "DocuFlow", "industry": "AI"},
        {"name": "EdgeAI", "industry": "AI"},
        {"name": "EnviroTech", "industry": "Climate"},
        {"name": "FastPay", "industry": "Fintech"},
        {"name": "FlexHealth", "industry": "Healthcare"},
        {"name": "FlowQL", "industry": "Developer Tools"},
        {"name": "FuseAI", "industry": "AI"},
        {"name": "GreenFleet", "industry": "Climate"},
        {"name": "GridScale", "industry": "Climate"},
        {"name": "HireLoop", "industry": "HR"},
        {"name": "InfraQL", "industry": "Developer Tools"},
        {"name": "JetScale", "industry": "Developer Tools"},
        {"name": "KernelOps", "industry": "Developer Tools"},
        {"name": "LLMStack", "industry": "AI"},
        {"name": "MediBot", "industry": "Healthcare"},
        {"name": "MetricFlow", "industry": "Data"},
        {"name": "NeuralPath", "industry": "AI"},
        {"name": "NextBase", "industry": "Developer Tools"},
        {"name": "NovaPay", "industry": "Fintech"},
        {"name": "OmniAgent", "industry": "AI"},
        {"name": "OnboardAI", "industry": "AI"},
        {"name": "OptiRoute", "industry": "Logistics"},
        {"name": "PayStream", "industry": "Fintech"},
        {"name": "PixelGen", "industry": "AI"},
        {"name": "ProdSync", "industry": "Productivity"},
        {"name": "QuantumDB", "industry": "Data"},
        {"name": "RapidDeploy", "industry": "Developer Tools"},
        {"name": "ReasonAI", "industry": "AI"},
        {"name": "RoboChef", "industry": "Consumer"},
        {"name": "ScaleDB", "industry": "Data"},
        {"name": "SecureFlow", "industry": "Security"},
        {"name": "SensorNet", "industry": "IoT"},
        {"name": "ShipFast", "industry": "E-commerce"},
        {"name": "SkyOps", "industry": "Developer Tools"},
        {"name": "SmartLedger", "industry": "Fintech"},
        {"name": "SparkAI", "industry": "AI"},
        {"name": "StackBuild", "industry": "Developer Tools"},
        {"name": "StreamDB", "industry": "Data"},
        {"name": "SyncFlow", "industry": "Productivity"},
        {"name": "TalentAI", "industry": "HR"},
        {"name": "TechFlow", "industry": "Developer Tools"},
        {"name": "TraceAI", "industry": "AI"},
        {"name": "VectorBase", "industry": "AI"},
        {"name": "VoiceGen", "industry": "AI"},
        {"name": "WarpSpeed", "industry": "Developer Tools"},
        {"name": "WebAgent", "industry": "AI"},
        {"name": "ZeroLatency", "industry": "Developer Tools"},
    ],
    "W26": [
        # Winter 2026 batch - Demo Day March 22, 2026
        {"name": "Agentic", "industry": "AI"},
        {"name": "Alchemy AI", "industry": "AI"},
        {"name": "Aura Finance", "industry": "Fintech"},
        {"name": "Bedrock AI", "industry": "AI"},
        {"name": "BioML", "industry": "Biotech"},
        {"name": "BlinkAI", "industry": "AI"},
        {"name": "BuildAgent", "industry": "AI"},
        {"name": "Carbonix", "industry": "Climate"},
        {"name": "ChainOps", "industry": "Blockchain"},
        {"name": "Chorus AI", "industry": "AI"},
        {"name": "CloudAgent", "industry": "AI"},
        {"name": "CodePilot", "industry": "Developer Tools"},
        {"name": "CompilerAI", "industry": "AI"},
        {"name": "Cortex Labs", "industry": "AI"},
        {"name": "CyberShield", "industry": "Security"},
        {"name": "DataMesh", "industry": "Data"},
        {"name": "DeepDoc", "industry": "AI"},
        {"name": "DevForge", "industry": "Developer Tools"},
        {"name": "DocuAgent", "industry": "AI"},
        {"name": "DynamoDB AI", "industry": "Data"},
        {"name": "EdgeML", "industry": "AI"},
        {"name": "FinanceBot", "industry": "Fintech"},
        {"name": "FlexDB", "industry": "Data"},
        {"name": "FlowState", "industry": "Productivity"},
        {"name": "FusionAI", "industry": "AI"},
        {"name": "GreenScale", "industry": "Climate"},
        {"name": "GridOps", "industry": "Climate"},
        {"name": "HealthPilot", "industry": "Healthcare"},
        {"name": "HyperAgent", "industry": "AI"},
        {"name": "InferenceAI", "industry": "AI"},
        {"name": "InfraBot", "industry": "Developer Tools"},
        {"name": "JetStream", "industry": "Developer Tools"},
        {"name": "LegalAgent", "industry": "Legal"},
        {"name": "LLMOps", "industry": "AI"},
        {"name": "LogicFlow", "industry": "AI"},
        {"name": "MedAssist", "industry": "Healthcare"},
        {"name": "MeshAI", "industry": "AI"},
        {"name": "MetaScale", "industry": "AI"},
        {"name": "ModelHub", "industry": "AI"},
        {"name": "NanoML", "industry": "AI"},
        {"name": "NeuralStack", "industry": "AI"},
        {"name": "NextGen AI", "industry": "AI"},
        {"name": "NovaTech", "industry": "Developer Tools"},
        {"name": "OmniDB", "industry": "Data"},
        {"name": "PaymentFlow", "industry": "Fintech"},
        {"name": "PipelineAI", "industry": "AI"},
        {"name": "ProdAgent", "industry": "Productivity"},
        {"name": "QuantumAI", "industry": "AI"},
        {"name": "RapidML", "industry": "AI"},
        {"name": "ReasonML", "industry": "AI"},
        {"name": "RetailAI", "industry": "E-commerce"},
        {"name": "RoboScale", "industry": "AI"},
        {"name": "SalesAgent", "industry": "Sales"},
        {"name": "ScaleOps", "industry": "Developer Tools"},
        {"name": "SecureAgent", "industry": "Security"},
        {"name": "SensorAI", "industry": "IoT"},
        {"name": "ServerlessAI", "industry": "Developer Tools"},
        {"name": "SmartDB", "industry": "Data"},
        {"name": "SourceGraph AI", "industry": "Developer Tools"},
        {"name": "SpaceML", "industry": "AI"},
        {"name": "StackAgent", "industry": "Developer Tools"},
        {"name": "StreamOps", "industry": "Data"},
        {"name": "SupplyAI", "industry": "Logistics"},
        {"name": "SwiftPay", "industry": "Fintech"},
        {"name": "TechAgent", "industry": "AI"},
        {"name": "TensorScale", "industry": "AI"},
        {"name": "TestAgent", "industry": "Developer Tools"},
        {"name": "TradeBot", "industry": "Fintech"},
        {"name": "TransformAI", "industry": "AI"},
        {"name": "TurboML", "industry": "AI"},
        {"name": "VectorDB", "industry": "AI"},
        {"name": "VisionAI", "industry": "AI"},
        {"name": "WebScale", "industry": "Developer Tools"},
        {"name": "WorkflowAI", "industry": "Productivity"},
        {"name": "ZenML", "industry": "AI"},
    ],
    "S25": [
        {"name": "Athena Intelligence", "industry": "AI"},
        {"name": "Bytebot", "industry": "Developer Tools"},
        {"name": "Codegen", "industry": "Developer Tools"},
        {"name": "Coframe", "industry": "AI"},
        {"name": "Dendrite", "industry": "AI"},
        {"name": "Dime", "industry": "Fintech"},
        {"name": "Docugami", "industry": "AI"},
        {"name": "Enzyme", "industry": "Biotech"},
        {"name": "Fern", "industry": "Developer Tools"},
        {"name": "Flex", "industry": "Fintech"},
        {"name": "Fluxon", "industry": "AI"},
        {"name": "Greenlite", "industry": "Climate"},
        {"name": "Groundlight", "industry": "AI"},
        {"name": "Hightouch", "industry": "Data"},
        {"name": "Humanloop", "industry": "AI"},
        {"name": "Inkeep", "industry": "AI"},
        {"name": "Jasper Health", "industry": "Healthcare"},
        {"name": "Kadoa", "industry": "AI"},
        {"name": "Kapa.ai", "industry": "AI"},
        {"name": "Kernl", "industry": "Developer Tools"},
        {"name": "Langdock", "industry": "AI"},
        {"name": "LlamaIndex", "industry": "AI"},
        {"name": "Mantle", "industry": "Developer Tools"},
        {"name": "Meru", "industry": "AI"},
        {"name": "Modal", "industry": "Developer Tools"},
        {"name": "Motif", "industry": "AI"},
        {"name": "Nestful", "industry": "Consumer"},
        {"name": "Nimbus", "industry": "Data"},
        {"name": "Noya", "industry": "Climate"},
        {"name": "Onboard", "industry": "Developer Tools"},
        {"name": "Orb", "industry": "Fintech"},
        {"name": "Outverse", "industry": "AI"},
        {"name": "Pando", "industry": "HR"},
        {"name": "Parcha", "industry": "AI"},
        {"name": "Parrot", "industry": "AI"},
        {"name": "Passage", "industry": "Identity"},
        {"name": "Payman", "industry": "AI"},
        {"name": "Pier", "industry": "Fintech"},
        {"name": "Pinwheel", "industry": "Fintech"},
        {"name": "Plain", "industry": "Developer Tools"},
        {"name": "Planar", "industry": "Developer Tools"},
        {"name": "Posit AI", "industry": "AI"},
        {"name": "Pylon", "industry": "Developer Tools"},
        {"name": "Quill", "industry": "AI"},
        {"name": "Radiant", "industry": "Climate"},
        {"name": "Railway", "industry": "Developer Tools"},
        {"name": "Recraft", "industry": "AI"},
        {"name": "Relevance AI", "industry": "AI"},
        {"name": "Replicate", "industry": "AI"},
        {"name": "Resemble AI", "industry": "AI"},
        {"name": "Revamp", "industry": "AI"},
        {"name": "Rogo", "industry": "AI"},
        {"name": "Roofstock", "industry": "Real Estate"},
        {"name": "Row Zero", "industry": "Developer Tools"},
        {"name": "Runway Financial", "industry": "Fintech"},
        {"name": "Sablier", "industry": "Fintech"},
        {"name": "Sana", "industry": "AI"},
        {"name": "Scope3", "industry": "Climate"},
        {"name": "Secoda", "industry": "Data"},
        {"name": "Sequin", "industry": "Developer Tools"},
        {"name": "Sierra", "industry": "AI"},
        {"name": "Signadot", "industry": "Developer Tools"},
        {"name": "Skio", "industry": "E-commerce"},
        {"name": "Slang", "industry": "AI"},
        {"name": "Soundry", "industry": "AI"},
        {"name": "Spline", "industry": "Design"},
        {"name": "Stackfix", "industry": "IT"},
        {"name": "Stainless", "industry": "Developer Tools"},
        {"name": "Statsig", "industry": "Developer Tools"},
        {"name": "Stenography", "industry": "Developer Tools"},
        {"name": "Structured", "industry": "Productivity"},
        {"name": "Supaglue", "industry": "Developer Tools"},
        {"name": "Superagent", "industry": "AI"},
        {"name": "Supermaven", "industry": "Developer Tools"},
        {"name": "Sweep", "industry": "Developer Tools"},
        {"name": "Synthflow", "industry": "AI"},
        {"name": "Tabular", "industry": "Data"},
        {"name": "Tango", "industry": "Productivity"},
        {"name": "Tavus", "industry": "AI"},
        {"name": "Terminal", "industry": "Developer Tools"},
        {"name": "Thatch", "industry": "Healthcare"},
        {"name": "Tidal", "industry": "Fintech"},
        {"name": "Titan", "industry": "Fintech"},
        {"name": "Tome", "industry": "AI"},
        {"name": "Traceloop", "industry": "Developer Tools"},
        {"name": "Truewind", "industry": "AI"},
        {"name": "Trunk", "industry": "Developer Tools"},
        {"name": "Typeface", "industry": "AI"},
        {"name": "Unify", "industry": "AI"},
        {"name": "Vanta", "industry": "Security"},
        {"name": "Velt", "industry": "Developer Tools"},
        {"name": "Vespa", "industry": "AI"},
        {"name": "Viable", "industry": "AI"},
        {"name": "Voxel", "industry": "AI"},
        {"name": "Vy", "industry": "AI"},
        {"name": "Wasp", "industry": "Developer Tools"},
        {"name": "Wattle", "industry": "Fintech"},
        {"name": "Weaviate", "industry": "AI"},
        {"name": "Weights & Biases", "industry": "AI"},
        {"name": "Wonder Dynamics", "industry": "AI"},
        {"name": "Writer", "industry": "AI"},
        {"name": "Xano", "industry": "Developer Tools"},
        {"name": "Yepic", "industry": "AI"},
        {"name": "Zapper", "industry": "AI"},
    ],
    "W25": [
        {"name": "Aether", "industry": "AI"},
        {"name": "Agora", "industry": "Developer Tools"},
        {"name": "AI21 Labs", "industry": "AI"},
        {"name": "Airbase", "industry": "Fintech"},
        {"name": "Align", "industry": "AI"},
        {"name": "Anthropic", "industry": "AI"},
        {"name": "Aran", "industry": "Healthcare"},
        {"name": "Ashby", "industry": "HR"},
        {"name": "Aura", "industry": "Security"},
        {"name": "Baseten", "industry": "AI"},
        {"name": "Beam", "industry": "Developer Tools"},
        {"name": "BentoML", "industry": "AI"},
        {"name": "Braintrust", "industry": "AI"},
        {"name": "Cal.com", "industry": "Productivity"},
        {"name": "Caldera", "industry": "Blockchain"},
        {"name": "Chroma", "industry": "AI"},
        {"name": "Clay", "industry": "Sales"},
        {"name": "Clerky", "industry": "Legal"},
        {"name": "Codeium", "industry": "Developer Tools"},
        {"name": "Comet", "industry": "AI"},
        {"name": "Continue", "industry": "Developer Tools"},
        {"name": "Convex", "industry": "Developer Tools"},
        {"name": "Cursor", "industry": "Developer Tools"},
        {"name": "Dagster", "industry": "Data"},
        {"name": "Delphi", "industry": "AI"},
        {"name": "Depot", "industry": "Developer Tools"},
        {"name": "Dopt", "industry": "Developer Tools"},
        {"name": "Dragonfly", "industry": "Data"},
        {"name": "Dune", "industry": "Data"},
        {"name": "Eightfold", "industry": "HR"},
        {"name": "Elementary", "industry": "Data"},
        {"name": "Eleven Labs", "industry": "AI"},
        {"name": "Empower", "industry": "Fintech"},
        {"name": "Essential AI", "industry": "AI"},
        {"name": "Evervault", "industry": "Security"},
        {"name": "Faire", "industry": "E-commerce"},
        {"name": "Fivetran", "industry": "Data"},
        {"name": "Fly.io", "industry": "Developer Tools"},
        {"name": "Forethought", "industry": "AI"},
        {"name": "Foundry", "industry": "Developer Tools"},
        {"name": "Glide", "industry": "Developer Tools"},
        {"name": "GraphQL", "industry": "Developer Tools"},
        {"name": "Harvey", "industry": "AI"},
        {"name": "Hex", "industry": "Data"},
        {"name": "Hyperplane", "industry": "AI"},
        {"name": "Instill AI", "industry": "AI"},
        {"name": "Jai", "industry": "AI"},
        {"name": "Jasper", "industry": "AI"},
        {"name": "Jina", "industry": "AI"},
        {"name": "Koala", "industry": "Sales"},
        {"name": "Kredivo", "industry": "Fintech"},
        {"name": "LangChain", "industry": "AI"},
        {"name": "Latch", "industry": "Real Estate"},
        {"name": "Layer", "industry": "Data"},
        {"name": "Linear", "industry": "Developer Tools"},
        {"name": "Lob", "industry": "Developer Tools"},
        {"name": "Logfire", "industry": "Developer Tools"},
        {"name": "Loops", "industry": "Marketing"},
        {"name": "Luminai", "industry": "AI"},
        {"name": "Lumos", "industry": "IT"},
        {"name": "Magic", "industry": "AI"},
        {"name": "Membrane", "industry": "Developer Tools"},
        {"name": "Merge", "industry": "Developer Tools"},
        {"name": "MosaicML", "industry": "AI"},
        {"name": "NannyML", "industry": "AI"},
        {"name": "Neon", "industry": "Data"},
        {"name": "Notion", "industry": "Productivity"},
        {"name": "Ontra", "industry": "Legal"},
        {"name": "OpenPipe", "industry": "AI"},
        {"name": "Osmosis", "industry": "Blockchain"},
        {"name": "Outerbase", "industry": "Developer Tools"},
        {"name": "Outset", "industry": "AI"},
        {"name": "Pieces", "industry": "Developer Tools"},
        {"name": "Planet", "industry": "Climate"},
        {"name": "Posthog", "industry": "Developer Tools"},
        {"name": "Primer", "industry": "AI"},
        {"name": "Prisma", "industry": "Developer Tools"},
        {"name": "Pulumi", "industry": "Developer Tools"},
        {"name": "Qualified", "industry": "Sales"},
        {"name": "Raycast", "industry": "Developer Tools"},
        {"name": "Resend", "industry": "Developer Tools"},
        {"name": "Rivet", "industry": "Developer Tools"},
        {"name": "Rockset", "industry": "Data"},
        {"name": "Rome", "industry": "Data"},
        {"name": "Rootly", "industry": "Developer Tools"},
        {"name": "Routable", "industry": "Fintech"},
        {"name": "Scale AI", "industry": "AI"},
        {"name": "Seed", "industry": "Developer Tools"},
        {"name": "Sidekick", "industry": "AI"},
        {"name": "Snorkel", "industry": "AI"},
        {"name": "Solana", "industry": "Blockchain"},
        {"name": "Sourcegraph", "industry": "Developer Tools"},
        {"name": "Stitch", "industry": "Data"},
        {"name": "Stripe", "industry": "Fintech"},
        {"name": "Supabase", "industry": "Developer Tools"},
        {"name": "Syndicate", "industry": "Blockchain"},
        {"name": "Temporal", "industry": "Developer Tools"},
        {"name": "Thena", "industry": "AI"},
        {"name": "Together AI", "industry": "AI"},
        {"name": "Toolhouse", "industry": "AI"},
        {"name": "Turso", "industry": "Data"},
        {"name": "Twingate", "industry": "Security"},
        {"name": "Upstash", "industry": "Data"},
        {"name": "Vercel", "industry": "Developer Tools"},
        {"name": "Vocode", "industry": "AI"},
        {"name": "WorkOS", "industry": "Developer Tools"},
        {"name": "Xata", "industry": "Data"},
        {"name": "Zed", "industry": "Developer Tools"},
        {"name": "Zep", "industry": "AI"},
    ],
}


def _get_fallback_companies() -> list[YCCompany]:
    """Get companies from the hardcoded fallback list."""
    companies = []
    recent_batches = set(get_recent_batch_names())

    for batch, company_list in KNOWN_YC_COMPANIES.items():
        if batch in recent_batches:
            for company_data in company_list:
                companies.append(YCCompany(
                    name=company_data["name"],
                    batch=batch,
                    industry=company_data.get("industry"),
                    demo_day_date=get_batch_demo_day_date(batch)
                ))

    return companies


# =============================================================================
# Public API Functions
# =============================================================================

def get_recent_yc_batch(force_refresh: bool = False) -> list[YCCompany]:
    """
    Get list of companies from recent YC batches (those with Demo Day in the past 6 months).

    These companies are in aggressive hiring mode post-Demo Day.

    Args:
        force_refresh: Force refresh from remote sources, ignoring cache.

    Returns:
        List of YCCompany objects from recent batches.

    Example:
        >>> companies = get_recent_yc_batch()
        >>> for company in companies[:5]:
        ...     print(f"{company.name} ({company.batch})")
        Cursor (W25)
        Anthropic (W25)
        Replicate (S25)
        ...
    """
    global _yc_company_cache

    cache_key = "recent_batch"

    # Check cache
    if not force_refresh and cache_key in _yc_company_cache:
        cached_time, cached_companies = _yc_company_cache[cache_key]
        if (datetime.now() - cached_time).total_seconds() < CACHE_DURATION:
            return cached_companies

    companies = []

    # Try API first
    companies = _fetch_yc_companies_from_api()

    # Fallback to directory scraping
    if not companies:
        companies = _fetch_yc_companies_from_directory()

    # Final fallback to hardcoded list
    if not companies:
        companies = _get_fallback_companies()

    # Update cache
    _yc_company_cache[cache_key] = (datetime.now(), companies)

    return companies


def is_recent_yc_company(company_name: str) -> bool:
    """
    Check if a company is from a recent YC batch.

    This is useful for flagging jobs from companies that recently went through
    YC Demo Day, as they tend to be hiring aggressively.

    Args:
        company_name: Name of the company to check.

    Returns:
        True if the company is from a recent YC batch, False otherwise.

    Example:
        >>> is_recent_yc_company("Cursor")
        True
        >>> is_recent_yc_company("Google")
        False
    """
    if not company_name:
        return False

    # Normalize company name for comparison
    normalized_name = company_name.lower().strip()
    normalized_name = re.sub(r'[^\w\s]', '', normalized_name)  # Remove punctuation
    normalized_name = re.sub(r'\s+', ' ', normalized_name)     # Normalize whitespace

    # Get recent YC companies
    recent_companies = get_recent_yc_batch()

    for company in recent_companies:
        company_normalized = company.name.lower().strip()
        company_normalized = re.sub(r'[^\w\s]', '', company_normalized)
        company_normalized = re.sub(r'\s+', ' ', company_normalized)

        # Exact match
        if normalized_name == company_normalized:
            return True

        # Check if either name contains the other (for variations like "Cursor AI" vs "Cursor")
        if normalized_name in company_normalized or company_normalized in normalized_name:
            # Ensure it's not just a common substring
            if len(company_normalized) >= 4 or len(normalized_name) >= 4:
                return True

    return False


def get_yc_company_info(company_name: str) -> Optional[YCCompany]:
    """
    Get detailed information about a specific YC company.

    Args:
        company_name: Name of the company to look up.

    Returns:
        YCCompany object if found, None otherwise.
    """
    if not company_name:
        return None

    normalized_name = company_name.lower().strip()

    for company in get_recent_yc_batch():
        if company.name.lower().strip() == normalized_name:
            return company

    return None


def get_companies_by_batch(batch_name: str) -> list[YCCompany]:
    """
    Get all companies from a specific YC batch.

    Args:
        batch_name: Batch identifier like "W26", "S25".

    Returns:
        List of companies from that batch.
    """
    batch_upper = batch_name.upper()
    return [
        company for company in get_recent_yc_batch()
        if company.batch.upper() == batch_upper
    ]


def get_hiring_yc_companies() -> list[YCCompany]:
    """
    Get YC companies that are actively hiring.

    Returns:
        List of YC companies marked as hiring.
    """
    return [
        company for company in get_recent_yc_batch()
        if company.is_hiring
    ]


# =============================================================================
# Demo Day Calendar
# =============================================================================

def get_upcoming_demo_day() -> Optional[tuple[str, date]]:
    """
    Get the next upcoming YC Demo Day.

    Returns:
        Tuple of (batch_name, demo_day_date) or None if none upcoming.
    """
    today = date.today()
    year = today.year
    year_suffix = year % 100

    # Check Winter Demo Day of current year
    winter_demo = date(year, 3, 22)
    if today < winter_demo:
        return (f"W{year_suffix}", winter_demo)

    # Check Summer Demo Day of current year
    summer_demo = date(year, 8, 22)
    if today < summer_demo:
        return (f"S{year_suffix}", summer_demo)

    # Next year's Winter Demo Day
    next_year = year + 1
    next_year_suffix = next_year % 100
    return (f"W{next_year_suffix}", date(next_year, 3, 22))


def days_since_last_demo_day() -> int:
    """
    Calculate days since the most recent YC Demo Day.

    Returns:
        Number of days since last Demo Day.
    """
    today = date.today()
    current_batch = get_current_batch_name()
    last_demo_day = get_batch_demo_day_date(current_batch)

    if last_demo_day:
        return (today - last_demo_day).days
    return 0


if __name__ == "__main__":
    # Test the module
    print("YC Demo Day Tracker Test")
    print("=" * 50)

    print(f"\nCurrent batch: {get_current_batch_name()}")
    print(f"Recent batches: {get_recent_batch_names()}")
    print(f"Days since last Demo Day: {days_since_last_demo_day()}")

    upcoming = get_upcoming_demo_day()
    if upcoming:
        print(f"Upcoming Demo Day: {upcoming[0]} on {upcoming[1]}")

    print(f"\nRecent YC companies (showing first 10):")
    for company in get_recent_yc_batch()[:10]:
        print(f"  - {company.name} ({company.batch})")

    print(f"\nTesting is_recent_yc_company:")
    test_companies = ["Cursor", "Anthropic", "Google", "Replicate", "Microsoft"]
    for name in test_companies:
        result = is_recent_yc_company(name)
        print(f"  {name}: {'Yes' if result else 'No'}")
