"""
Salary Parser - Extract salary information from job descriptions.

Handles various formats:
- "$150,000 - $180,000"
- "$150K - $180K"
- "150,000 - 180,000 USD"
- "Base salary: $150,000"
- "$75/hr" (converts to annual)
- "Compensation range: 150K-180K"
"""

import re
from typing import Optional, Tuple


def parse_salary_from_text(text: str) -> Tuple[Optional[int], Optional[int]]:
    """
    Extract salary range from job description text.

    Returns:
        Tuple of (salary_min, salary_max) in annual USD, or (None, None) if not found.
    """
    if not text:
        return None, None

    # Normalize text
    text = text.lower().replace(',', '').replace(' ', '')

    # Patterns to try (in order of specificity)
    patterns = [
        # "$150,000 - $180,000" or "$150000-$180000"
        r'\$(\d{2,3})[\d,]*\s*[-–to]+\s*\$?(\d{2,3})[\d,]*(?:k|000)?',

        # "$150K - $180K" or "$150k-180k"
        r'\$(\d{2,3})k?\s*[-–to]+\s*\$?(\d{2,3})k',

        # "150K - 180K" without dollar sign
        r'(\d{2,3})k\s*[-–to]+\s*(\d{2,3})k',

        # "$150,000" single value
        r'\$(\d{3,})(?:000)?(?:\s*(?:base|annual|yearly|salary))?',

        # "$150K" single value
        r'\$(\d{2,3})k(?:\s*(?:base|annual|yearly|salary))?',
    ]

    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            groups = match.groups()

            if len(groups) == 2:
                # Range found
                min_val = _normalize_salary(groups[0])
                max_val = _normalize_salary(groups[1])
                if min_val and max_val and _is_valid_range(min_val, max_val):
                    return min_val, max_val
            elif len(groups) == 1:
                # Single value found
                val = _normalize_salary(groups[0])
                if val and _is_valid_salary(val):
                    return val, val

    # Try hourly rate patterns
    hourly_match = re.search(r'\$(\d{2,3})(?:\.?\d{0,2})?\s*(?:/\s*)?(?:hr|hour|hourly)', text)
    if hourly_match:
        hourly = float(hourly_match.group(1))
        annual = int(hourly * 2080)  # 40 hrs * 52 weeks
        if _is_valid_salary(annual):
            return annual, annual

    return None, None


def _normalize_salary(value: str) -> Optional[int]:
    """Convert salary string to annual integer."""
    try:
        # Remove non-numeric chars except decimal
        clean = re.sub(r'[^\d.]', '', value)
        num = float(clean)

        # If it's a small number, assume it's in thousands
        if num < 1000:
            num *= 1000

        return int(num)
    except (ValueError, TypeError):
        return None


def _is_valid_salary(salary: int) -> bool:
    """Check if salary is in reasonable range for tech jobs."""
    return 40000 <= salary <= 1000000


def _is_valid_range(min_val: int, max_val: int) -> bool:
    """Check if salary range is reasonable."""
    if not _is_valid_salary(min_val) or not _is_valid_salary(max_val):
        return False
    if min_val > max_val:
        return False
    # Range shouldn't be more than 3x
    if max_val > min_val * 3:
        return False
    return True


def extract_salary_context(text: str) -> dict:
    """
    Extract salary with additional context.

    Returns dict with:
        - salary_min: int or None
        - salary_max: int or None
        - confidence: 'high' | 'medium' | 'low'
        - source_text: the matched text snippet
    """
    salary_min, salary_max = parse_salary_from_text(text)

    if salary_min is None:
        return {
            'salary_min': None,
            'salary_max': None,
            'confidence': 'none',
            'source_text': None
        }

    # Determine confidence based on context
    text_lower = text.lower()
    confidence = 'medium'

    # High confidence indicators
    high_confidence_terms = [
        'base salary', 'annual salary', 'yearly salary',
        'compensation range', 'salary range', 'pay range',
        'total compensation', 'base pay'
    ]
    if any(term in text_lower for term in high_confidence_terms):
        confidence = 'high'

    # Low confidence indicators (might be total comp, not base)
    low_confidence_terms = [
        'total comp', 'on-target', 'ote', 'bonus', 'equity',
        'stock', 'rsu', 'up to'
    ]
    if any(term in text_lower for term in low_confidence_terms):
        confidence = 'low'

    return {
        'salary_min': salary_min,
        'salary_max': salary_max,
        'confidence': confidence,
        'source_text': 'extracted from job description'
    }


# Quick test
if __name__ == '__main__':
    test_cases = [
        "The salary range for this position is $150,000 - $180,000 annually.",
        "Base salary: $175K - $225K plus equity",
        "Compensation: 150K-200K USD",
        "$85/hr contract position",
        "We offer competitive pay around $165,000",
        "No salary info here",
        "Total compensation $300K-$500K including equity",  # Should be low confidence
    ]

    for text in test_cases:
        result = extract_salary_context(text)
        print(f"\nInput: {text[:50]}...")
        print(f"Result: ${result['salary_min']}-${result['salary_max']} ({result['confidence']})")
