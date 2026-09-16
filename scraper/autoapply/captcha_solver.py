"""Hybrid CAPTCHA solver: tries FREE methods first, CapSolver fallback.

Strategy:
  1. Turnstile → FlareSolverr (FREE, ~70%)
  2. hCaptcha → hcaptcha-challenger ML (FREE, ~85%)
  3. reCAPTCHA v3 → nodriver stealth (FREE, ~80%)
  4. reCAPTCHA v2 → YOLO detection (FREE, ~65%)
  5. Any failure → CapSolver API (PAID, ~95%)

Usage:
    from captcha_solver import solve_captcha
    result = await solve_captcha(page, captcha_type="recaptcha_v2")
    # Returns: {"success": True, "token": "...", "method": "yolo"}
    #      or: {"success": False, "error": "all methods failed"}
"""
from __future__ import annotations

import os
import re
import asyncio
import logging
import base64
from io import BytesIO
from typing import Optional
from dataclasses import dataclass

logger = logging.getLogger("captcha_solver")

# Environment config
CAPSOLVER_API_KEY = os.environ.get("CAPSOLVER_API_KEY", "")
ENABLE_PAID_FALLBACK = os.environ.get("ENABLE_PAID_CAPTCHA", "false").lower() == "true"


@dataclass
class SolveResult:
    success: bool
    token: Optional[str] = None
    method: str = "none"
    error: Optional[str] = None
    cost: float = 0.0  # USD


# ============================================================================
# CAPTCHA TYPE DETECTION
# ============================================================================

def detect_captcha_type(html: str) -> str:
    """Detect CAPTCHA type from page HTML."""
    html_lower = html.lower()

    if "turnstile" in html_lower or "cf-turnstile" in html_lower:
        return "turnstile"
    if "hcaptcha" in html_lower or "h-captcha" in html_lower:
        return "hcaptcha"
    if "recaptcha/enterprise" in html_lower:
        return "recaptcha_enterprise"
    if "grecaptcha.execute" in html_lower or "recaptcha/api.js?render=" in html_lower:
        return "recaptcha_v3"
    if "g-recaptcha" in html_lower or "recaptcha" in html_lower:
        return "recaptcha_v2"
    return "unknown"


def extract_sitekey(html: str, captcha_type: str) -> Optional[str]:
    """Extract sitekey from HTML for the detected CAPTCHA type."""
    patterns = {
        "recaptcha_v2": [
            r'data-sitekey=["\']([^"\']+)["\']',
            r'grecaptcha\.render\([^,]+,\s*\{[^}]*sitekey:\s*["\']([^"\']+)["\']',
        ],
        "recaptcha_v3": [
            r'grecaptcha\.execute\(["\']([^"\']+)["\']',
            r'recaptcha/api\.js\?render=([^"\'&]+)',
        ],
        "hcaptcha": [
            r'data-sitekey=["\']([^"\']+)["\']',
            r'hcaptcha\.render\([^,]+,\s*\{[^}]*sitekey:\s*["\']([^"\']+)["\']',
        ],
        "turnstile": [
            r'data-sitekey=["\']([^"\']+)["\']',
            r'turnstile\.render\([^,]+,\s*\{[^}]*sitekey:\s*["\']([^"\']+)["\']',
        ],
    }

    for pattern in patterns.get(captcha_type, []):
        match = re.search(pattern, html, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


# ============================================================================
# FREE SOLVERS
# ============================================================================

async def solve_with_nodriver_stealth(page_url: str, sitekey: str,
                                       captcha_type: str) -> SolveResult:
    """Try to pass reCAPTCHA v3 using stealth browser (FREE).

    Works ~80% of the time for v3 invisible challenges.
    """
    try:
        import nodriver as uc
    except ImportError:
        return SolveResult(success=False, error="nodriver not installed")

    try:
        browser = await uc.start(headless=True)
        page = await browser.get(page_url)

        # Wait for reCAPTCHA to load and execute
        await asyncio.sleep(3)

        # For v3, the token should be generated automatically if we pass the score
        # Try to extract the token from the page
        token = await page.evaluate("""
            () => {
                const el = document.querySelector('[name="g-recaptcha-response"]');
                return el ? el.value : null;
            }
        """)

        await browser.stop()

        if token and len(token) > 20:
            return SolveResult(success=True, token=token, method="nodriver_stealth")
        return SolveResult(success=False, error="no token generated", method="nodriver_stealth")

    except Exception as e:
        logger.warning(f"nodriver stealth failed: {e}")
        return SolveResult(success=False, error=str(e), method="nodriver_stealth")


async def solve_with_flaresolverr(page_url: str) -> SolveResult:
    """Solve Cloudflare Turnstile using FlareSolverr (FREE, self-hosted Docker).

    Requires: docker run -p 8191:8191 ghcr.io/flaresolverr/flaresolverr
    """
    import aiohttp

    flaresolverr_url = os.environ.get("FLARESOLVERR_URL", "http://localhost:8191/v1")

    try:
        async with aiohttp.ClientSession() as session:
            payload = {
                "cmd": "request.get",
                "url": page_url,
                "maxTimeout": 60000,
            }
            async with session.post(flaresolverr_url, json=payload, timeout=65) as resp:
                data = await resp.json()

                if data.get("status") == "ok":
                    # FlareSolverr returns cookies that bypass Turnstile
                    cookies = data.get("solution", {}).get("cookies", [])
                    return SolveResult(
                        success=True,
                        token=str(cookies),  # Cookies act as the "token"
                        method="flaresolverr"
                    )
                return SolveResult(success=False, error=data.get("message"), method="flaresolverr")

    except Exception as e:
        logger.warning(f"FlareSolverr failed: {e}")
        return SolveResult(success=False, error=str(e), method="flaresolverr")


async def solve_with_hcaptcha_challenger(page_url: str, sitekey: str) -> SolveResult:
    """Solve hCaptcha using ML (FREE, ~85% accuracy).

    Requires: pip install hcaptcha-challenger
    """
    try:
        from hcaptcha_challenger import new_challenger
    except ImportError:
        return SolveResult(success=False, error="hcaptcha-challenger not installed")

    try:
        import nodriver as uc

        browser = await uc.start(headless=True)
        page = await browser.get(page_url)

        challenger = new_challenger()
        result = await challenger.solve(page)

        await browser.stop()

        if result:
            return SolveResult(success=True, token=result, method="hcaptcha_challenger")
        return SolveResult(success=False, error="challenge failed", method="hcaptcha_challenger")

    except Exception as e:
        logger.warning(f"hcaptcha-challenger failed: {e}")
        return SolveResult(success=False, error=str(e), method="hcaptcha_challenger")


async def solve_with_yolo(page_url: str, sitekey: str) -> SolveResult:
    """Solve reCAPTCHA v2 image grid using YOLO (FREE, ~65% accuracy).

    Only works for COCO classes: traffic lights, buses, cars, bicycles, etc.
    """
    try:
        from ultralytics import YOLO
        import nodriver as uc
        from PIL import Image
    except ImportError as e:
        return SolveResult(success=False, error=f"missing dependency: {e}")

    # COCO class mapping to reCAPTCHA prompts
    COCO_MAP = {
        "traffic light": [9],
        "fire hydrant": [10],
        "stop sign": [11],
        "parking meter": [12],
        "bus": [5],
        "car": [2],
        "motorcycle": [3],
        "bicycle": [1],
        "boat": [8],
    }

    try:
        model = YOLO('yolov8m.pt')
        browser = await uc.start(headless=True)
        page = await browser.get(page_url)

        # Find and click reCAPTCHA checkbox
        await asyncio.sleep(2)
        checkbox = await page.query_selector('.recaptcha-checkbox-border')
        if checkbox:
            await checkbox.click()
            await asyncio.sleep(3)

        # Check if challenge appeared
        challenge_frame = None
        for frame in page.frames:
            if 'bframe' in frame.url:
                challenge_frame = frame
                break

        if not challenge_frame:
            # May have auto-passed
            token = await page.evaluate("""
                () => document.querySelector('[name="g-recaptcha-response"]')?.value
            """)
            await browser.stop()
            if token:
                return SolveResult(success=True, token=token, method="yolo_autopass")
            return SolveResult(success=False, error="no challenge frame found")

        # Extract prompt
        prompt_el = await challenge_frame.query_selector('.rc-imageselect-desc-wrapper')
        prompt = await prompt_el.inner_text() if prompt_el else ""
        prompt_lower = prompt.lower()

        # Find target class
        target_classes = []
        for name, class_ids in COCO_MAP.items():
            if name in prompt_lower:
                target_classes = class_ids
                break

        if not target_classes:
            await browser.stop()
            return SolveResult(success=False, error=f"unknown category: {prompt}", method="yolo")

        # Screenshot and solve grid
        grid_el = await challenge_frame.query_selector('.rc-imageselect-challenge')
        screenshot = await grid_el.screenshot()
        img = Image.open(BytesIO(screenshot))

        # Split into tiles
        width, height = img.size
        grid_size = 3 if width <= 330 else 4
        tile_w, tile_h = width // grid_size, height // grid_size

        tiles_to_click = []
        for row in range(grid_size):
            for col in range(grid_size):
                tile = img.crop((col * tile_w, row * tile_h,
                                (col + 1) * tile_w, (row + 1) * tile_h))
                results = model.predict(tile, conf=0.4, verbose=False)

                for det in results[0].boxes:
                    if int(det.cls[0]) in target_classes:
                        tiles_to_click.append(row * grid_size + col)
                        break

        # Click matching tiles
        for idx in tiles_to_click:
            tile_selector = f'.rc-imageselect-tile:nth-child({idx + 1})'
            tile_el = await challenge_frame.query_selector(tile_selector)
            if tile_el:
                await tile_el.click()
                await asyncio.sleep(0.3)

        # Click verify
        verify_btn = await challenge_frame.query_selector('.rc-button-default')
        if verify_btn:
            await verify_btn.click()
            await asyncio.sleep(2)

        # Check result
        token = await page.evaluate("""
            () => document.querySelector('[name="g-recaptcha-response"]')?.value
        """)

        await browser.stop()

        if token and len(token) > 20:
            return SolveResult(success=True, token=token, method="yolo")
        return SolveResult(success=False, error="verification failed", method="yolo")

    except Exception as e:
        logger.warning(f"YOLO solver failed: {e}")
        return SolveResult(success=False, error=str(e), method="yolo")


# ============================================================================
# PAID FALLBACK: CAPSOLVER
# ============================================================================

async def solve_with_capsolver(page_url: str, sitekey: str,
                                captcha_type: str) -> SolveResult:
    """Solve any CAPTCHA using CapSolver API (PAID, ~95% accuracy).

    Cost: ~$0.0008 per solve ($0.80 per 1000)
    """
    if not CAPSOLVER_API_KEY:
        return SolveResult(success=False, error="CAPSOLVER_API_KEY not set")

    import aiohttp

    # Map our types to CapSolver task types
    task_types = {
        "recaptcha_v2": "ReCaptchaV2TaskProxyLess",
        "recaptcha_v3": "ReCaptchaV3TaskProxyLess",
        "recaptcha_enterprise": "ReCaptchaV2EnterpriseTaskProxyLess",
        "hcaptcha": "HCaptchaTaskProxyLess",
        "turnstile": "AntiTurnstileTaskProxyLess",
    }

    task_type = task_types.get(captcha_type)
    if not task_type:
        return SolveResult(success=False, error=f"unsupported type: {captcha_type}")

    try:
        async with aiohttp.ClientSession() as session:
            # Create task
            create_payload = {
                "clientKey": CAPSOLVER_API_KEY,
                "task": {
                    "type": task_type,
                    "websiteURL": page_url,
                    "websiteKey": sitekey,
                }
            }

            # Add v3 specific params
            if captcha_type == "recaptcha_v3":
                create_payload["task"]["pageAction"] = "submit"
                create_payload["task"]["minScore"] = 0.7

            async with session.post(
                "https://api.capsolver.com/createTask",
                json=create_payload,
                timeout=30
            ) as resp:
                data = await resp.json()

                if data.get("errorId") != 0:
                    return SolveResult(
                        success=False,
                        error=data.get("errorDescription"),
                        method="capsolver"
                    )

                task_id = data.get("taskId")

            # Poll for result
            for _ in range(60):  # Max 60 attempts (60 seconds)
                await asyncio.sleep(1)

                async with session.post(
                    "https://api.capsolver.com/getTaskResult",
                    json={"clientKey": CAPSOLVER_API_KEY, "taskId": task_id},
                    timeout=30
                ) as resp:
                    data = await resp.json()

                    status = data.get("status")
                    if status == "ready":
                        token = data.get("solution", {}).get("gRecaptchaResponse")
                        if not token:
                            token = data.get("solution", {}).get("token")

                        return SolveResult(
                            success=True,
                            token=token,
                            method="capsolver",
                            cost=0.0008  # Approximate cost per solve
                        )
                    elif status == "failed":
                        return SolveResult(
                            success=False,
                            error=data.get("errorDescription"),
                            method="capsolver"
                        )

            return SolveResult(success=False, error="timeout", method="capsolver")

    except Exception as e:
        logger.error(f"CapSolver failed: {e}")
        return SolveResult(success=False, error=str(e), method="capsolver")


# ============================================================================
# MAIN HYBRID SOLVER
# ============================================================================

async def solve_captcha(page_url: str, html: str = "",
                        captcha_type: str = "", sitekey: str = "") -> SolveResult:
    """Hybrid CAPTCHA solver: tries FREE methods first, CapSolver fallback.

    Args:
        page_url: URL of the page with CAPTCHA
        html: Page HTML (for detection if type/sitekey not provided)
        captcha_type: Override detected type
        sitekey: Override detected sitekey

    Returns:
        SolveResult with success, token, method used, and cost
    """
    # Auto-detect if not provided
    if not captcha_type and html:
        captcha_type = detect_captcha_type(html)
    if not sitekey and html:
        sitekey = extract_sitekey(html, captcha_type) or ""

    logger.info(f"Solving {captcha_type} on {page_url[:50]}...")

    # Try FREE methods based on CAPTCHA type
    result = SolveResult(success=False, error="no solver attempted")

    if captcha_type == "turnstile":
        result = await solve_with_flaresolverr(page_url)

    elif captcha_type == "hcaptcha":
        result = await solve_with_hcaptcha_challenger(page_url, sitekey)

    elif captcha_type == "recaptcha_v3":
        result = await solve_with_nodriver_stealth(page_url, sitekey, captcha_type)

    elif captcha_type == "recaptcha_v2":
        # Try YOLO first
        result = await solve_with_yolo(page_url, sitekey)

    elif captcha_type == "recaptcha_enterprise":
        # Enterprise is harder, try stealth first
        result = await solve_with_nodriver_stealth(page_url, sitekey, captcha_type)

    # If FREE method succeeded, return
    if result.success:
        logger.info(f"FREE solve succeeded: {result.method}")
        return result

    # PAID FALLBACK: CapSolver
    if ENABLE_PAID_FALLBACK and CAPSOLVER_API_KEY:
        logger.info(f"FREE solve failed ({result.error}), trying CapSolver...")
        paid_result = await solve_with_capsolver(page_url, sitekey, captcha_type)
        if paid_result.success:
            logger.info(f"CapSolver succeeded (cost: ${paid_result.cost:.4f})")
            return paid_result
        result = paid_result  # Update with paid result error

    logger.warning(f"All solvers failed: {result.error}")
    return result


# ============================================================================
# CONVENIENCE FUNCTIONS
# ============================================================================

def solve_captcha_sync(page_url: str, html: str = "",
                       captcha_type: str = "", sitekey: str = "") -> SolveResult:
    """Synchronous wrapper for solve_captcha."""
    return asyncio.run(solve_captcha(page_url, html, captcha_type, sitekey))


async def check_free_solvable(captcha_type: str) -> dict:
    """Check if a CAPTCHA type can be solved for free."""
    free_rates = {
        "turnstile": {"solvable": True, "rate": 0.70, "method": "FlareSolverr"},
        "hcaptcha": {"solvable": True, "rate": 0.85, "method": "hcaptcha-challenger"},
        "recaptcha_v3": {"solvable": True, "rate": 0.80, "method": "nodriver stealth"},
        "recaptcha_v2": {"solvable": True, "rate": 0.65, "method": "YOLO (COCO classes only)"},
        "recaptcha_enterprise": {"solvable": False, "rate": 0.40, "method": "nodriver (low success)"},
    }
    return free_rates.get(captcha_type, {"solvable": False, "rate": 0, "method": "none"})


if __name__ == "__main__":
    # Test the solver
    import sys

    test_url = sys.argv[1] if len(sys.argv) > 1 else "https://www.google.com/recaptcha/api2/demo"

    async def test():
        result = await solve_captcha(test_url, captcha_type="recaptcha_v2")
        print(f"Result: {result}")

    asyncio.run(test())
