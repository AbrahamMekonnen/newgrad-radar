#!/usr/bin/env python3
"""
AI Cost Calculator for Auto-Apply System
Calculates actual monthly costs based on usage and pricing.
"""

# ============================================
# USAGE ASSUMPTIONS
# ============================================
USERS = 20
APPS_PER_USER_PER_DAY = 5
CALLS_PER_APP = 40  # AI calls per application (form filling, questions, etc.)
TOKENS_PER_CALL = 800  # Average tokens per call (input + output)
BUSINESS_HOURS_PER_DAY = 8
DAYS_PER_MONTH = 30

# Derived
TOTAL_APPS_PER_DAY = USERS * APPS_PER_USER_PER_DAY
TOTAL_CALLS_PER_DAY = TOTAL_APPS_PER_DAY * CALLS_PER_APP
TOTAL_CALLS_PER_MONTH = TOTAL_CALLS_PER_DAY * DAYS_PER_MONTH
TOTAL_TOKENS_PER_DAY = TOTAL_CALLS_PER_DAY * TOKENS_PER_CALL
TOTAL_TOKENS_PER_MONTH = TOTAL_TOKENS_PER_DAY * DAYS_PER_MONTH

# Token split (typically more input than output)
INPUT_RATIO = 0.7
OUTPUT_RATIO = 0.3
INPUT_TOKENS_PER_MONTH = TOTAL_TOKENS_PER_MONTH * INPUT_RATIO
OUTPUT_TOKENS_PER_MONTH = TOTAL_TOKENS_PER_MONTH * OUTPUT_RATIO

# ============================================
# PROVIDER PRICING (per 1M tokens)
# ============================================
PROVIDERS = {
    "groq_free": {
        "name": "Groq (Free Tier)",
        "input_per_1m": 0,  # Free
        "output_per_1m": 0,  # Free
        "rpm_limit": 30,
        "daily_limit": 14400,  # Requests per day
        "monthly_limit": 14400 * 30,  # ~432K requests
        "notes": "Free but rate limited"
    },
    "groq_paid": {
        "name": "Groq (Paid)",
        "input_per_1m": 0.05,  # Llama 3.1 8B
        "output_per_1m": 0.08,
        "rpm_limit": 100,  # Higher on paid
        "daily_limit": None,  # Unlimited
        "monthly_limit": None,
        "notes": "Pay per token, higher limits"
    },
    "groq_70b_paid": {
        "name": "Groq 70B (Paid)",
        "input_per_1m": 0.59,
        "output_per_1m": 0.79,
        "rpm_limit": 100,
        "daily_limit": None,
        "monthly_limit": None,
        "notes": "Higher quality model"
    },
    "gemini_free": {
        "name": "Gemini Flash (Free)",
        "input_per_1m": 0,
        "output_per_1m": 0,
        "rpm_limit": 15,
        "daily_limit": 1500,
        "monthly_limit": 1500 * 30,  # ~45K requests
        "notes": "Free but very limited"
    },
    "gemini_paid": {
        "name": "Gemini Flash (Paid)",
        "input_per_1m": 0.075,
        "output_per_1m": 0.30,
        "rpm_limit": 360,
        "daily_limit": None,
        "monthly_limit": None,
        "notes": "Pay per token, high RPM"
    },
    "deepseek": {
        "name": "DeepSeek V2",
        "input_per_1m": 0.14,
        "output_per_1m": 0.28,
        "rpm_limit": 60,
        "daily_limit": None,
        "monthly_limit": None,
        "notes": "Chinese provider, no daily cap"
    },
    "together_llama8b": {
        "name": "Together AI (Llama 8B)",
        "input_per_1m": 0.18,
        "output_per_1m": 0.18,
        "rpm_limit": 600,
        "daily_limit": None,
        "monthly_limit": None,
        "notes": "High RPM"
    },
    "openai_4o_mini": {
        "name": "OpenAI GPT-4o-mini",
        "input_per_1m": 0.15,
        "output_per_1m": 0.60,
        "rpm_limit": 500,  # Tier 1
        "daily_limit": None,
        "monthly_limit": None,
        "notes": "Needs $5 spend for Tier 1"
    },
    "qwen_7b_openrouter": {
        "name": "Qwen 2 7B (OpenRouter)",
        "input_per_1m": 0.07,
        "output_per_1m": 0.07,
        "rpm_limit": 200,
        "daily_limit": None,
        "monthly_limit": None,
        "notes": "Via OpenRouter aggregator"
    },
}


def calculate_cost(provider_key: str) -> dict:
    """Calculate monthly cost for a single provider."""
    p = PROVIDERS[provider_key]

    # Check if free tier covers usage
    if p.get("monthly_limit"):
        if TOTAL_CALLS_PER_MONTH <= p["monthly_limit"]:
            return {
                "provider": p["name"],
                "monthly_cost": 0,
                "fits_free_tier": True,
                "overflow_calls": 0,
                "rpm": p["rpm_limit"],
                "notes": p["notes"]
            }
        else:
            overflow = TOTAL_CALLS_PER_MONTH - p["monthly_limit"]
            # Can't use overflow on free tier - need paid
            return {
                "provider": p["name"],
                "monthly_cost": None,  # Need to upgrade
                "fits_free_tier": False,
                "overflow_calls": overflow,
                "rpm": p["rpm_limit"],
                "notes": f"Exceeds free tier by {overflow:,} calls"
            }

    # Paid tier - calculate token cost
    input_cost = (INPUT_TOKENS_PER_MONTH / 1_000_000) * p["input_per_1m"]
    output_cost = (OUTPUT_TOKENS_PER_MONTH / 1_000_000) * p["output_per_1m"]
    total_cost = input_cost + output_cost

    return {
        "provider": p["name"],
        "monthly_cost": round(total_cost, 2),
        "fits_free_tier": False,
        "overflow_calls": 0,
        "rpm": p["rpm_limit"],
        "notes": p["notes"]
    }


def calculate_combo(primary_key: str, fallback_key: str, primary_ratio: float = 0.8) -> dict:
    """Calculate cost for primary + fallback combo."""
    primary = PROVIDERS[primary_key]
    fallback = PROVIDERS[fallback_key]

    # Split tokens between providers
    primary_input = INPUT_TOKENS_PER_MONTH * primary_ratio
    primary_output = OUTPUT_TOKENS_PER_MONTH * primary_ratio
    fallback_input = INPUT_TOKENS_PER_MONTH * (1 - primary_ratio)
    fallback_output = OUTPUT_TOKENS_PER_MONTH * (1 - primary_ratio)

    # Calculate costs (0 for free tier providers)
    primary_cost = (
        (primary_input / 1_000_000) * primary["input_per_1m"] +
        (primary_output / 1_000_000) * primary["output_per_1m"]
    )
    fallback_cost = (
        (fallback_input / 1_000_000) * fallback["input_per_1m"] +
        (fallback_output / 1_000_000) * fallback["output_per_1m"]
    )

    total_cost = primary_cost + fallback_cost
    combined_rpm = primary["rpm_limit"] + fallback["rpm_limit"]

    return {
        "combo": f"{primary['name']} + {fallback['name']}",
        "monthly_cost": round(total_cost, 2),
        "combined_rpm": combined_rpm,
        "split": f"{int(primary_ratio*100)}% / {int((1-primary_ratio)*100)}%"
    }


def main():
    print("=" * 70)
    print("AI COST CALCULATOR FOR AUTO-APPLY SYSTEM")
    print("=" * 70)

    print(f"\n📊 USAGE ASSUMPTIONS:")
    print(f"   Users: {USERS}")
    print(f"   Apps per user per day: {APPS_PER_USER_PER_DAY}")
    print(f"   AI calls per app: {CALLS_PER_APP}")
    print(f"   Tokens per call: {TOKENS_PER_CALL}")
    print(f"   Business hours: {BUSINESS_HOURS_PER_DAY}")

    print(f"\n📈 DERIVED VOLUMES:")
    print(f"   Total apps/day: {TOTAL_APPS_PER_DAY:,}")
    print(f"   Total calls/day: {TOTAL_CALLS_PER_DAY:,}")
    print(f"   Total calls/month: {TOTAL_CALLS_PER_MONTH:,}")
    print(f"   Total tokens/month: {TOTAL_TOKENS_PER_MONTH:,} ({TOTAL_TOKENS_PER_MONTH/1_000_000:.1f}M)")
    print(f"   Input tokens/month: {INPUT_TOKENS_PER_MONTH:,} ({INPUT_TOKENS_PER_MONTH/1_000_000:.1f}M)")
    print(f"   Output tokens/month: {OUTPUT_TOKENS_PER_MONTH:,} ({OUTPUT_TOKENS_PER_MONTH/1_000_000:.1f}M)")

    print(f"\n💰 SINGLE PROVIDER COSTS:")
    print("-" * 70)
    print(f"{'Provider':<30} {'Cost/mo':<12} {'RPM':<8} {'Notes'}")
    print("-" * 70)

    for key in PROVIDERS:
        result = calculate_cost(key)
        cost_str = f"${result['monthly_cost']:.2f}" if result['monthly_cost'] is not None else "N/A (limit)"
        if result['monthly_cost'] == 0:
            cost_str = "$0 (FREE)"
        print(f"{result['provider']:<30} {cost_str:<12} {result['rpm']:<8} {result['notes']}")

    print(f"\n🔀 COMBO STRATEGIES:")
    print("-" * 70)
    print(f"{'Combo':<45} {'Cost/mo':<12} {'RPM':<8} {'Split'}")
    print("-" * 70)

    combos = [
        ("groq_free", "gemini_free", 0.8),
        ("groq_free", "gemini_paid", 0.8),
        ("groq_paid", "gemini_paid", 0.7),
        ("groq_70b_paid", "gemini_paid", 0.7),
        ("groq_free", "deepseek", 0.5),
        ("gemini_paid", "deepseek", 0.7),
    ]

    for primary, fallback, ratio in combos:
        result = calculate_combo(primary, fallback, ratio)
        print(f"{result['combo']:<45} ${result['monthly_cost']:<11.2f} {result['combined_rpm']:<8} {result['split']}")

    print(f"\n🎯 BYOK (Bring Your Own Key) STRATEGY:")
    print("-" * 70)
    byok_rpm = USERS * 30  # Each user has their own Groq free tier
    byok_daily = USERS * 14400
    print(f"   {USERS} users × 30 RPM each = {byok_rpm} RPM total")
    print(f"   {USERS} users × 14,400/day each = {byok_daily:,}/day total")
    print(f"   Your need: {TOTAL_CALLS_PER_DAY:,}/day = {TOTAL_CALLS_PER_DAY/byok_daily*100:.1f}% utilization")
    print(f"   Cost: $0 (users bring their own free keys)")

    print(f"\n✅ RECOMMENDATION:")
    print("-" * 70)
    if TOTAL_CALLS_PER_MONTH <= 432000:  # Groq free limit
        print("   Groq Free Tier alone can handle your volume!")
        print(f"   {TOTAL_CALLS_PER_MONTH:,} calls/month < 432,000 limit")
        print("   Cost: $0")
    else:
        print("   Option 1: BYOK model - $0 (users bring own keys)")
        print("   Option 2: Gemini Paid - ~$3-8/month")
        print("   Option 3: Groq Free + Gemini Paid combo - ~$1-3/month")


if __name__ == "__main__":
    main()
