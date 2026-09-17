import sys
import unittest
from pathlib import Path
from unittest.mock import patch

AUTOAPPLY_DIR = Path(__file__).resolve().parent
SCRAPER_DIR = AUTOAPPLY_DIR.parent
for directory in (str(AUTOAPPLY_DIR), str(SCRAPER_DIR)):
    if directory not in sys.path:
        sys.path.insert(0, directory)

import field_knowledge_base as kb
import greenhouse_adapter as gh
import prepare_worker
import submit
from salary_market import market_salary, salary_answer


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table, rows):
        self.table = table
        self.rows = rows

    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def single(self):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args):
        return self

    def execute(self):
        return _Result(self.rows.get(self.table, []))


class _Client:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        return _Query(name, self.rows)


class AutoApplyRegressionTests(unittest.TestCase):
    def test_profile_derives_sponsorship_and_location(self):
        client = _Client({
            "user_profiles": {
                "first_name": "A",
                "location": "Seattle, WA",
                "work_authorization": "us_citizen",
                "require_sponsorship": None,
                "custom_answers": {},
            },
            "generated_answers": [],
            "user_story_bank": [],
        })
        profile = prepare_worker.build_profile(client, "user")
        self.assertFalse(profile.require_sponsorship)
        self.assertTrue(profile.is_us_citizen)
        self.assertEqual("Seattle", profile.city)
        self.assertEqual("WA", profile.state)

    def test_common_questions_are_categorized_and_resolved(self):
        self.assertEqual(
            "age_verification",
            kb.lookup_category("At the time of application, are you 18+ years of age?"),
        )
        self.assertEqual(
            "data_consent",
            kb.lookup_category("Please review and acknowledge the Applicant Privacy Notice"),
        )
        profile = gh.Profile(is_adult=True, background_check_consent=True)
        self.assertEqual(
            ("yes-id", "matched"),
            gh._resolve_one(
                "age_verification", "select",
                [{"label": "Yes", "value": "yes-id"}, {"label": "No", "value": "no-id"}],
                profile, "Are you 18+?",
            ),
        )
        self.assertEqual(
            ("ack-id", "matched"),
            gh._resolve_one(
                "data_consent", "select",
                [{"label": "I acknowledge and agree", "value": "ack-id"}],
                profile, "Privacy Notice",
            ),
        )

        sponsorship_profile = gh.Profile(require_sponsorship=False)
        self.assertEqual(
            (0, "matched"),
            gh._resolve_one(
                "sponsorship", "select",
                [{"label": "Yes", "value": 1}, {"label": "No", "value": 0}],
                sponsorship_profile, "Will you require sponsorship?",
            ),
        )

    def test_market_salary_prefers_posted_then_levels_data(self):
        profile = gh.Profile(salary_type="market_rate", salary_display_strategy="show_range")
        posted = market_salary({"salary_min": 130000, "salary_max": 160000}, profile)
        self.assertEqual("job posting", posted["source"])
        self.assertEqual("$130,000 - $160,000 base", salary_answer("Expected salary", "text", posted, profile))
        levels = market_salary({"company_slug": "palantir", "title": "Software Engineer"}, profile)
        self.assertEqual("levels.fyi", levels["source"])
        self.assertGreater(levels["max"], levels["min"])

    def test_safe_option_inferences(self):
        source_profile = gh.Profile(how_heard="Company careers page")
        self.assertEqual(
            ("career-id", "matched"),
            gh._resolve_one("source", "select", [{"label": "Verkada Careers Page", "value": "career-id"}], source_profile, "How did you hear about this role?"),
        )
        former_profile = gh.Profile(previously_employed_here=False)
        self.assertEqual(
            ("never-id", "matched"),
            gh._resolve_one("custom", "select", [{"label": "Never worked at Alphabet", "value": "never-id"}], former_profile, "Are you a current or former Alphabet employee, intern, vendor, contractor, or temp?"),
        )
        bay_profile = gh.Profile(location="Oakland, CA")
        self.assertEqual(
            ("yes-id", "matched"),
            gh._resolve_one("in_office", "select", [{"label": "Yes", "value": "yes-id"}, {"label": "No", "value": "no-id"}], bay_profile, "Do you currently live in/around the SF Bay Area?"),
        )
        self.assertEqual(
            ("ack-id", "matched"),
            gh._resolve_one("custom", "select", [{"label": "I acknowledge the above policies", "value": "ack-id"}], gh.Profile(), "By submitting, I acknowledge and agree to these interview guidelines."),
        )

    def test_age_is_never_assumed(self):
        value, source = gh._resolve_one(
            "age_verification", "select", [{"label": "Yes", "value": "yes"}, {"label": "No", "value": "no"}],
            gh.Profile(), "Are you 18 or older?",
        )
        self.assertIsNone(value)
        self.assertEqual("user_needed", source)

    def test_learned_answer_remaps_to_current_option_id(self):
        profile = gh.Profile(custom_answers={
            "preferred coding language": "Python 3",
        })
        value, source = gh._resolve_one(
            "coding_language", "select",
            [{"label": "Python 3", "value": "option-42"}],
            profile, "Preferred coding language",
        )
        self.assertEqual("option-42", value)
        self.assertEqual("matched", source)

    def test_shared_captcha_detector_is_used_for_typed_handoff(self):
        class Response:
            status_code = 200
            text = '<div class="h-captcha" data-sitekey="site-key"></div>'

        with patch.object(submit.requests, "get", return_value=Response()):
            gated, detail = submit.detect_captcha("https://example.test/apply")

        self.assertTrue(gated)
        self.assertIn("hcaptcha", detail)
        self.assertIn("sitekey present", detail)
    def test_incomplete_form_is_reported_before_captcha(self):
        fields = [{
            "name": "required_question", "label": "Required question",
            "required": True, "source": "user_needed", "value": None,
        }]
        with patch.object(submit, "detect_captcha", side_effect=AssertionError("should not fetch")):
            result = submit.submit_application(
                "greenhouse", "company", "123",
                "https://example.com", fields, dry_run=True,
            )
        self.assertEqual("incomplete", result["status"])


if __name__ == "__main__":
    unittest.main()

