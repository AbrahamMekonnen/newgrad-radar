"""
Smart AI Provider Router

Routes AI calls between providers based on:
1. Free tier availability (Gemini first, then Groq)
2. Rate limit tracking (pre-calculate to avoid mid-operation stops)
3. Groq paid as final fallback

Rules:
- Gemini Free: Only use when free tier available
- Groq Free: Primary backup, handles bursts
- Groq Paid: Final fallback when both free exhausted
"""

import os
import time
import asyncio
from collections import deque
from dataclasses import dataclass, field
from typing import Optional, Callable, Any
from enum import Enum


class ProviderType(Enum):
    GEMINI_FREE = "gemini_free"
    GROQ_FREE = "groq_free"
    GROQ_PAID = "groq_paid"


@dataclass
class ProviderConfig:
    name: str
    provider_type: ProviderType
    rpm_limit: int  # Requests per minute
    rpd_limit: Optional[int]  # Requests per day (None = unlimited)
    is_paid: bool = False
    cost_per_1m_input: float = 0.0
    cost_per_1m_output: float = 0.0


@dataclass
class ProviderState:
    config: ProviderConfig
    calls_this_minute: deque = field(default_factory=deque)
    calls_today: int = 0
    day_started: float = field(default_factory=time.time)
    total_cost: float = 0.0
    is_available: bool = True
    last_error: Optional[str] = None

    def reset_daily_if_needed(self):
        """Reset daily counter if new day."""
        now = time.time()
        if now - self.day_started > 86400:  # 24 hours
            self.calls_today = 0
            self.day_started = now

    def clean_minute_window(self):
        """Remove calls older than 60 seconds."""
        now = time.time()
        while self.calls_this_minute and self.calls_this_minute[0] < now - 60:
            self.calls_this_minute.popleft()

    def calls_in_last_minute(self) -> int:
        self.clean_minute_window()
        return len(self.calls_this_minute)

    def rpm_available(self) -> int:
        """How many more calls can we make this minute."""
        return max(0, self.config.rpm_limit - self.calls_in_last_minute())

    def rpd_available(self) -> int:
        """How many more calls can we make today."""
        self.reset_daily_if_needed()
        if self.config.rpd_limit is None:
            return float('inf')
        return max(0, self.config.rpd_limit - self.calls_today)

    def can_handle(self, num_calls: int) -> bool:
        """Can this provider handle N calls right now?"""
        if not self.is_available:
            return False
        return self.rpm_available() >= num_calls and self.rpd_available() >= num_calls

    def record_call(self):
        """Record a call was made."""
        self.calls_this_minute.append(time.time())
        self.calls_today += 1

    def seconds_until_rpm_available(self) -> float:
        """How long until we have RPM capacity."""
        if self.rpm_available() > 0:
            return 0
        if not self.calls_this_minute:
            return 0
        oldest = self.calls_this_minute[0]
        return max(0, (oldest + 60) - time.time())


class SmartRouter:
    """
    Smart router that:
    1. Pre-calculates which provider to use based on expected calls
    2. Uses Gemini Free when available (best for moderate load)
    3. Uses Groq Free for bursts (higher RPM)
    4. Falls back to Groq Paid only when free tiers exhausted
    """

    def __init__(self):
        # Provider configurations
        self.providers = {
            ProviderType.GEMINI_FREE: ProviderState(
                config=ProviderConfig(
                    name="Gemini Flash (Free)",
                    provider_type=ProviderType.GEMINI_FREE,
                    rpm_limit=15,
                    rpd_limit=1500,
                    is_paid=False,
                )
            ),
            ProviderType.GROQ_FREE: ProviderState(
                config=ProviderConfig(
                    name="Groq (Free)",
                    provider_type=ProviderType.GROQ_FREE,
                    rpm_limit=30,
                    rpd_limit=14400,
                    is_paid=False,
                )
            ),
            ProviderType.GROQ_PAID: ProviderState(
                config=ProviderConfig(
                    name="Groq (Paid)",
                    provider_type=ProviderType.GROQ_PAID,
                    rpm_limit=100,
                    rpd_limit=None,  # Unlimited
                    is_paid=True,
                    cost_per_1m_input=0.05,
                    cost_per_1m_output=0.08,
                )
            ),
        }

        self._lock = asyncio.Lock()

    def check_providers_available(self) -> dict:
        """Check which providers are available and their capacity."""
        status = {}
        for ptype, state in self.providers.items():
            status[ptype.value] = {
                "name": state.config.name,
                "is_available": state.is_available,
                "rpm_available": state.rpm_available(),
                "rpd_available": state.rpd_available() if state.config.rpd_limit else "unlimited",
                "is_paid": state.config.is_paid,
            }
        return status

    def pre_calculate_provider(self, expected_calls: int) -> ProviderType:
        """
        Pre-calculate which provider to use based on expected call volume.

        Rules:
        1. If expected_calls > 5/min → Use Groq (avoid Gemini's 15 RPM limit)
        2. If Gemini has capacity → Use Gemini Free
        3. If Groq Free has capacity → Use Groq Free
        4. Fall back to Groq Paid
        """
        gemini = self.providers[ProviderType.GEMINI_FREE]
        groq_free = self.providers[ProviderType.GROQ_FREE]
        groq_paid = self.providers[ProviderType.GROQ_PAID]

        # Rule 1: High frequency → Skip Gemini, use Groq directly
        # If we expect > 5 calls per minute, Gemini's 15 RPM is too tight
        calls_per_minute = expected_calls / 1  # Assuming calls happen within ~1 min
        if calls_per_minute > 5:
            print(f"[Router] High frequency ({calls_per_minute:.1f} calls/min) → Using Groq")
            if groq_free.can_handle(expected_calls):
                return ProviderType.GROQ_FREE
            else:
                return ProviderType.GROQ_PAID

        # Rule 2: Check Gemini Free first
        if gemini.is_available and gemini.can_handle(expected_calls):
            return ProviderType.GEMINI_FREE

        # Rule 3: Check Groq Free
        if groq_free.is_available and groq_free.can_handle(expected_calls):
            return ProviderType.GROQ_FREE

        # Rule 4: Fall back to Groq Paid
        return ProviderType.GROQ_PAID

    async def get_provider_for_call(self) -> ProviderType:
        """
        Get the best provider for a single call.
        Uses locking to prevent race conditions.
        """
        async with self._lock:
            # Priority: Gemini Free → Groq Free → Groq Paid
            gemini = self.providers[ProviderType.GEMINI_FREE]
            groq_free = self.providers[ProviderType.GROQ_FREE]

            # Check Gemini first (if under 5 calls/min rate)
            if gemini.is_available and gemini.rpm_available() > 0 and gemini.rpd_available() > 0:
                # Only use Gemini if we're not in a burst
                if gemini.calls_in_last_minute() < 10:  # Not too busy
                    return ProviderType.GEMINI_FREE

            # Check Groq Free
            if groq_free.is_available and groq_free.rpm_available() > 0 and groq_free.rpd_available() > 0:
                return ProviderType.GROQ_FREE

            # Check if we need to wait for free tier capacity
            gemini_wait = gemini.seconds_until_rpm_available()
            groq_wait = groq_free.seconds_until_rpm_available()
            min_wait = min(gemini_wait, groq_wait)

            if min_wait > 0 and min_wait < 5:
                # Short wait - worth waiting for free tier
                print(f"[Router] Waiting {min_wait:.1f}s for free tier capacity...")
                await asyncio.sleep(min_wait)
                return await self.get_provider_for_call()

            # Fall back to paid
            return ProviderType.GROQ_PAID

    def record_call(self, provider_type: ProviderType, input_tokens: int = 0, output_tokens: int = 0):
        """Record that a call was made to a provider."""
        state = self.providers[provider_type]
        state.record_call()

        # Track cost for paid providers
        if state.config.is_paid:
            cost = (
                (input_tokens / 1_000_000) * state.config.cost_per_1m_input +
                (output_tokens / 1_000_000) * state.config.cost_per_1m_output
            )
            state.total_cost += cost

    def mark_provider_unavailable(self, provider_type: ProviderType, error: str):
        """Mark a provider as temporarily unavailable."""
        state = self.providers[provider_type]
        state.is_available = False
        state.last_error = error
        print(f"[Router] {state.config.name} marked unavailable: {error}")

    def mark_provider_available(self, provider_type: ProviderType):
        """Mark a provider as available again."""
        state = self.providers[provider_type]
        state.is_available = True
        state.last_error = None

    def get_stats(self) -> dict:
        """Get usage statistics."""
        stats = {
            "providers": {},
            "total_paid_cost": 0.0,
        }
        for ptype, state in self.providers.items():
            stats["providers"][ptype.value] = {
                "calls_today": state.calls_today,
                "calls_this_minute": state.calls_in_last_minute(),
                "rpm_available": state.rpm_available(),
                "rpd_available": state.rpd_available() if state.config.rpd_limit else "unlimited",
                "cost": state.total_cost if state.config.is_paid else 0,
            }
            if state.config.is_paid:
                stats["total_paid_cost"] += state.total_cost

        return stats

    def print_status(self):
        """Print current router status."""
        print("\n" + "=" * 60)
        print("SMART ROUTER STATUS")
        print("=" * 60)
        for ptype, state in self.providers.items():
            status = "✓" if state.is_available else "✗"
            paid = "(PAID)" if state.config.is_paid else "(FREE)"
            print(f"{status} {state.config.name} {paid}")
            print(f"    RPM: {state.calls_in_last_minute()}/{state.config.rpm_limit}")
            if state.config.rpd_limit:
                print(f"    Today: {state.calls_today}/{state.config.rpd_limit}")
            if state.config.is_paid:
                print(f"    Cost: ${state.total_cost:.4f}")
        print("=" * 60 + "\n")


# Singleton instance
_router: Optional[SmartRouter] = None


def get_router() -> SmartRouter:
    """Get the singleton router instance."""
    global _router
    if _router is None:
        _router = SmartRouter()
    return _router


# ============================================
# Integration helpers for browser-use agent
# ============================================

def create_llm_for_provider(provider_type: ProviderType):
    """Create the appropriate LLM client for a provider."""
    if provider_type == ProviderType.GEMINI_FREE:
        from browser_use import ChatGoogle
        return ChatGoogle(model="gemini-2.0-flash")

    elif provider_type in (ProviderType.GROQ_FREE, ProviderType.GROQ_PAID):
        from browser_use import ChatGroq
        return ChatGroq(model="llama-3.3-70b-versatile")

    raise ValueError(f"Unknown provider type: {provider_type}")


async def get_llm_with_routing(expected_calls: int = 1):
    """
    Get an LLM client with smart routing.

    Usage:
        llm = await get_llm_with_routing(expected_calls=40)
        # Use llm for your application
    """
    router = get_router()

    # Pre-calculate best provider
    provider_type = router.pre_calculate_provider(expected_calls)
    provider_name = router.providers[provider_type].config.name

    print(f"[Router] Selected: {provider_name} for {expected_calls} expected calls")

    return create_llm_for_provider(provider_type), provider_type


# ============================================
# Example usage
# ============================================

if __name__ == "__main__":
    import asyncio

    async def demo():
        router = get_router()

        print("Initial status:")
        router.print_status()

        # Simulate an application with 40 expected calls
        print("\n--- Starting application (40 expected calls) ---")
        llm, provider = await get_llm_with_routing(expected_calls=40)
        print(f"Got LLM from: {provider.value}")

        # Simulate some calls
        for i in range(10):
            provider = await router.get_provider_for_call()
            router.record_call(provider, input_tokens=500, output_tokens=200)
            print(f"Call {i+1}: {provider.value}")
            await asyncio.sleep(0.1)

        print("\nFinal status:")
        router.print_status()

        stats = router.get_stats()
        print(f"Total paid cost: ${stats['total_paid_cost']:.4f}")

    asyncio.run(demo())
