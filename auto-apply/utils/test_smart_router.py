#!/usr/bin/env python3
"""
Unit tests for SmartRouter
Tests rate limiting, provider selection, and cost tracking.
"""

import unittest
import asyncio
import time
from unittest.mock import patch, MagicMock
from collections import deque

from smart_router import (
    SmartRouter,
    ProviderType,
    ProviderConfig,
    ProviderState,
    get_router,
)


class TestProviderState(unittest.TestCase):
    """Test ProviderState rate limit tracking."""

    def setUp(self):
        self.config = ProviderConfig(
            name="Test Provider",
            provider_type=ProviderType.GROQ_FREE,
            rpm_limit=30,
            rpd_limit=100,
        )
        self.state = ProviderState(config=self.config)

    def test_initial_state(self):
        """Fresh state should have full capacity."""
        self.assertEqual(self.state.rpm_available(), 30)
        self.assertEqual(self.state.rpd_available(), 100)
        self.assertTrue(self.state.is_available)
        self.assertIsNone(self.state.last_error)

    def test_record_call_decrements_rpm(self):
        """Recording calls should decrement available RPM."""
        self.state.record_call()
        self.assertEqual(self.state.rpm_available(), 29)
        self.assertEqual(self.state.calls_today, 1)

    def test_rpm_window_expires(self):
        """Calls older than 60s should not count toward RPM."""
        old_time = time.time() - 61
        self.state.calls_this_minute.append(old_time)
        self.state.calls_today = 1

        self.state.clean_minute_window()
        self.assertEqual(self.state.calls_in_last_minute(), 0)
        self.assertEqual(self.state.rpm_available(), 30)

    def test_daily_reset(self):
        """Daily counter should reset after 24h."""
        self.state.calls_today = 50
        self.state.day_started = time.time() - 86401  # 24h + 1s ago

        self.state.reset_daily_if_needed()
        self.assertEqual(self.state.calls_today, 0)

    def test_can_handle_checks_both_limits(self):
        """can_handle should check both RPM and RPD."""
        self.assertTrue(self.state.can_handle(10))

        # Exhaust RPM
        for _ in range(30):
            self.state.record_call()
        self.assertFalse(self.state.can_handle(1))

    def test_unavailable_state(self):
        """Unavailable provider should not handle any calls."""
        self.state.is_available = False
        self.assertFalse(self.state.can_handle(1))

    def test_unlimited_rpd(self):
        """Provider with no RPD limit should report infinity."""
        config = ProviderConfig(
            name="Unlimited",
            provider_type=ProviderType.GROQ_PAID,
            rpm_limit=100,
            rpd_limit=None,
        )
        state = ProviderState(config=config)
        self.assertEqual(state.rpd_available(), float('inf'))


class TestSmartRouter(unittest.TestCase):
    """Test SmartRouter provider selection logic."""

    def setUp(self):
        self.router = SmartRouter()

    def test_initial_providers(self):
        """Router should have all three providers."""
        self.assertIn(ProviderType.GEMINI_FREE, self.router.providers)
        self.assertIn(ProviderType.GROQ_FREE, self.router.providers)
        self.assertIn(ProviderType.GROQ_PAID, self.router.providers)

    def test_pre_calculate_low_frequency_uses_gemini(self):
        """Low frequency (< 5/min) should prefer Gemini Free."""
        provider = self.router.pre_calculate_provider(expected_calls=3)
        self.assertEqual(provider, ProviderType.GEMINI_FREE)

    def test_pre_calculate_high_frequency_uses_groq(self):
        """High frequency (> 5/min) should use Groq for higher RPM."""
        provider = self.router.pre_calculate_provider(expected_calls=10)
        self.assertEqual(provider, ProviderType.GROQ_FREE)

    def test_pre_calculate_fallback_to_paid(self):
        """When free tiers exhausted, should fall back to paid."""
        # Exhaust both free tiers
        gemini = self.router.providers[ProviderType.GEMINI_FREE]
        groq = self.router.providers[ProviderType.GROQ_FREE]
        gemini.is_available = False
        groq.is_available = False

        provider = self.router.pre_calculate_provider(expected_calls=1)
        self.assertEqual(provider, ProviderType.GROQ_PAID)

    def test_record_call_tracks_cost_for_paid(self):
        """Paid provider calls should track cost."""
        self.router.record_call(
            ProviderType.GROQ_PAID,
            input_tokens=1_000_000,
            output_tokens=1_000_000
        )
        paid_state = self.router.providers[ProviderType.GROQ_PAID]
        # Cost = 1M * $0.05/1M + 1M * $0.08/1M = $0.13
        self.assertAlmostEqual(paid_state.total_cost, 0.13, places=2)

    def test_record_call_no_cost_for_free(self):
        """Free provider calls should not accumulate cost."""
        self.router.record_call(
            ProviderType.GROQ_FREE,
            input_tokens=1_000_000,
            output_tokens=1_000_000
        )
        free_state = self.router.providers[ProviderType.GROQ_FREE]
        self.assertEqual(free_state.total_cost, 0.0)

    def test_mark_provider_unavailable(self):
        """Should mark provider unavailable with error."""
        self.router.mark_provider_unavailable(
            ProviderType.GEMINI_FREE,
            "Rate limit exceeded"
        )
        state = self.router.providers[ProviderType.GEMINI_FREE]
        self.assertFalse(state.is_available)
        self.assertEqual(state.last_error, "Rate limit exceeded")

    def test_mark_provider_available(self):
        """Should restore provider availability."""
        self.router.mark_provider_unavailable(ProviderType.GEMINI_FREE, "Error")
        self.router.mark_provider_available(ProviderType.GEMINI_FREE)
        state = self.router.providers[ProviderType.GEMINI_FREE]
        self.assertTrue(state.is_available)
        self.assertIsNone(state.last_error)

    def test_check_providers_available(self):
        """Should return status for all providers."""
        status = self.router.check_providers_available()
        self.assertEqual(len(status), 3)
        self.assertIn("gemini_free", status)
        self.assertIn("groq_free", status)
        self.assertIn("groq_paid", status)

    def test_get_stats(self):
        """Should return usage statistics."""
        self.router.record_call(ProviderType.GROQ_FREE)
        stats = self.router.get_stats()
        self.assertIn("providers", stats)
        self.assertEqual(stats["providers"]["groq_free"]["calls_today"], 1)


class TestSmartRouterAsync(unittest.TestCase):
    """Test async methods of SmartRouter."""

    def setUp(self):
        self.router = SmartRouter()

    def test_get_provider_for_call_prefers_gemini(self):
        """Single call should prefer Gemini when available."""
        async def run_test():
            provider = await self.router.get_provider_for_call()
            return provider

        result = asyncio.run(run_test())
        self.assertEqual(result, ProviderType.GEMINI_FREE)

    def test_get_provider_for_call_busy_gemini_uses_groq(self):
        """When Gemini is busy, should use Groq."""
        async def run_test():
            # Make Gemini appear busy (10+ calls this minute)
            gemini = self.router.providers[ProviderType.GEMINI_FREE]
            for _ in range(12):
                gemini.record_call()

            provider = await self.router.get_provider_for_call()
            return provider

        result = asyncio.run(run_test())
        self.assertEqual(result, ProviderType.GROQ_FREE)

    def test_get_provider_for_call_exhausted_uses_paid(self):
        """When all free exhausted, should use paid."""
        async def run_test():
            # Exhaust both free tiers
            self.router.mark_provider_unavailable(ProviderType.GEMINI_FREE, "exhausted")
            self.router.mark_provider_unavailable(ProviderType.GROQ_FREE, "exhausted")

            provider = await self.router.get_provider_for_call()
            return provider

        result = asyncio.run(run_test())
        self.assertEqual(result, ProviderType.GROQ_PAID)


class TestSingletonRouter(unittest.TestCase):
    """Test singleton pattern."""

    def test_get_router_returns_same_instance(self):
        """get_router should return the same instance."""
        router1 = get_router()
        router2 = get_router()
        self.assertIs(router1, router2)


class TestProviderConfig(unittest.TestCase):
    """Test ProviderConfig defaults."""

    def test_default_values(self):
        """Config should have sensible defaults."""
        config = ProviderConfig(
            name="Test",
            provider_type=ProviderType.GROQ_FREE,
            rpm_limit=30,
            rpd_limit=100,
        )
        self.assertFalse(config.is_paid)
        self.assertEqual(config.cost_per_1m_input, 0.0)
        self.assertEqual(config.cost_per_1m_output, 0.0)


class TestRealWorldScenarios(unittest.TestCase):
    """Test realistic usage scenarios."""

    def setUp(self):
        self.router = SmartRouter()

    def test_20_users_5_apps_each(self):
        """Simulate 20 users applying to 5 jobs each."""
        apps_per_day = 20 * 5  # 100 apps
        calls_per_app = 40  # Average AI calls per application
        total_calls = apps_per_day * calls_per_app  # 4000 calls

        # Check if Groq free can handle it daily
        groq_daily_limit = 14400
        self.assertLess(total_calls, groq_daily_limit, "Should fit in Groq free tier")

        # Simulate a single user session (40 calls over ~10 min = ~4/min)
        provider = self.router.pre_calculate_provider(expected_calls=4)
        self.assertEqual(provider, ProviderType.GEMINI_FREE, "Low frequency should use Gemini")

        # Simulate burst scenario (10 calls in 1 min)
        provider = self.router.pre_calculate_provider(expected_calls=10)
        self.assertEqual(provider, ProviderType.GROQ_FREE, "High frequency should use Groq")

    def test_rate_limit_recovery(self):
        """Test recovery after hitting rate limits."""
        gemini = self.router.providers[ProviderType.GEMINI_FREE]

        # Simulate hitting rate limit
        for _ in range(15):  # Exhaust 15 RPM
            gemini.record_call()

        self.assertEqual(gemini.rpm_available(), 0)

        # Simulate time passing (60+ seconds)
        gemini.calls_this_minute.clear()

        self.assertEqual(gemini.rpm_available(), 15)

    def test_cost_projection(self):
        """Test cost tracking accuracy."""
        # Simulate 1000 paid calls
        for _ in range(1000):
            self.router.record_call(
                ProviderType.GROQ_PAID,
                input_tokens=500,
                output_tokens=300
            )

        stats = self.router.get_stats()
        # 1000 calls * (500 * $0.05/1M + 300 * $0.08/1M)
        # = 1000 * (0.000025 + 0.000024) = 1000 * 0.000049 = $0.049
        expected_cost = 0.049
        actual_cost = stats["total_paid_cost"]
        self.assertAlmostEqual(actual_cost, expected_cost, places=3)


if __name__ == "__main__":
    unittest.main()
