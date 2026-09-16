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

