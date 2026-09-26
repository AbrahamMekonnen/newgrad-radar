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
import lever_adapter as lever
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
    def test_optional_fields_do_not_block_authorized_submission(self):
        prepared = {
            "status": "prepared",
            "ready_pct": 65,
            "needs_user": [],
            "fields": [
                {"required": True, "value": "filled"},
                {"required": False, "value": None},
            ],
        }
        self.assertTrue(prepare_worker._is_submission_ready(prepared))
        prepared["needs_user"] = [{"required": True, "value": None}]
        self.assertFalse(prepare_worker._is_submission_ready(prepared))

    def test_profile_derives_sponsorship_and_location(self):
        client = _Client({
            "user_profiles": {
                "first_name": "A",
                "location": "Seattle, WA",
                "work_authorization": "us_citizen",
                "require_sponsorship": None,
                "custom_answers": {},
                "linkedin_url": "https:linkdein/johndowe",
                "preferred_name": None,
            },
            "generated_answers": [],
            "user_story_bank": [],
        })
        profile = prepare_worker.build_profile(client, "user")
        self.assertFalse(profile.require_sponsorship)
        self.assertTrue(profile.is_us_citizen)
        self.assertEqual("Seattle", profile.city)
        self.assertEqual("WA", profile.state)
        self.assertEqual("", profile.linkedin_url)
        self.assertEqual("A", profile.preferred_name)

    def test_resume_education_enrichment_is_conservative(self):
        profile = gh.Profile(
            resume_text=(
                "Education Eastern Mennonite University Harrisonburg, VA "
                "Bachelor of Science in Computer Science, Minor in Business; "
                "Aug. 2022 - May 2026 Experience Software Engineer"
            )
        )
        updates = prepare_worker._infer_education_from_resume(profile)
        self.assertEqual("Eastern Mennonite University", profile.school)
        self.assertEqual("Bachelor of Science in Computer Science", profile.degree)
        self.assertEqual("Computer Science", profile.major)
        self.assertEqual("2026", profile.graduation_year)
        self.assertEqual(profile.school, updates["education_school"])

    def test_specific_name_labels_beat_generic_full_name(self):
        self.assertEqual("preferred_name", kb.lookup_category("Preferred Name"))
        self.assertNotEqual("full_name", kb.lookup_category("Preferred Name"))

    def test_high_school_fields_never_map_to_person_name(self):
        self.assertEqual(gh._category("High School Name"), "high_school_name")
        self.assertEqual(
            gh._category("Year of High School Graduation"),
            "high_school_graduation_year",
        )
        profile = gh.Profile(
            first_name="Abraham",
            last_name="Mekonnen",
            custom_answers={"high_school_name": "Central High School"},
        )
        value, source = gh._resolve_one(
            "high_school_name", "input_text", [], profile, "High School Name"
        )
        self.assertEqual((value, source), ("Central High School", "profile"))

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

    def test_lever_high_school_name_never_uses_applicant_name(self):
        self.assertEqual(
            "high_school_name",
            lever._lever_category("High School Name", "cards[school][text]"),
        )
        missing = gh.Profile(first_name="Abraham", last_name="Mekonnen", custom_answers={})
        value, source = lever._lever_resolve_one(
            "high_school_name", "input", [], missing, "High School Name"
        )
        self.assertIsNone(value)
        self.assertEqual("user_needed", source)

        confirmed = gh.Profile(custom_answers={"__fact:high_school_name": "Central High School"})
        self.assertEqual(
            ("Central High School", "profile"),
            lever._lever_resolve_one(
                "high_school_name", "input", [], confirmed, "High School Name"
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

    def test_accenture_compliance_fields_are_not_identity_fields(self):
        current_gov = (
            "Are you a current employee of the U.S. Government or any state "
            "or local government?"
        )
        conditional = (
            "If yes, please list the full name of the employee(s) and your "
            "relationship to them."
        )
        self.assertEqual("government_employment", gh._category(current_gov, "question_1"))
        self.assertEqual("conditional_detail", gh._category(conditional, "question_2"))

        questions = [
            {
                "label": "State", "required": True,
                "fields": [{"name": "state", "type": "select", "values": [
                    {"label": "California", "value": "ca-id"},
                    {"label": "Washington", "value": "wa-id"},
                ]}],
            },
            {
                "label": current_gov, "required": True,
                "fields": [{"name": "question_1", "type": "select", "values": [
                    {"label": "Yes", "value": "yes-id"},
                    {"label": "No", "value": "no-id"},
                ]}],
            },
            {
                "label": conditional, "required": False,
                "fields": [{"name": "question_2", "type": "input_text", "values": []}],
            },
            {
                "label": "Please indicate your citizenship status",
                "required": True,
                "fields": [{"name": "question_3", "type": "select", "values": [
                    {"label": "U.S. Citizen", "value": "citizen-id"},
                    {"label": "Permanent Resident", "value": "pr-id"},
                ]}],
            },
        ]
        result = gh.resolve(
            questions,
            gh.Profile(state="CA", work_authorization="us_citizen", is_us_citizen=True),
        )
        fields = {field.name: field for field in result["resolved"]}
        self.assertEqual("ca-id", fields["state"].value)
        self.assertEqual("user_needed", fields["question_1"].source)
        self.assertIsNone(fields["question_1"].value)
        self.assertEqual("conditional", fields["question_2"].source)
        self.assertIsNone(fields["question_2"].value)
        self.assertEqual("citizen-id", fields["question_3"].value)
        self.assertEqual(["question_1"], [field.name for field in result["user_needed"]])

    def test_greenhouse_fetch_includes_hosted_form_sections(self):
        payload = {
            "questions": [{"label": "First Name", "required": True, "fields": [
                {"name": "first_name", "type": "input_text", "values": []}
            ]}],
            "location_questions": [
                {"label": "Longitude", "required": True, "fields": [
                    {"name": "longitude", "type": "input_hidden", "values": []}
                ]},
                {"label": "Location", "required": True, "fields": [
                    {"name": "location", "type": "input_text", "values": []}
                ]},
            ],
            "education": "education_required",
            "compliance": [{"questions": [
                {"label": "Gender", "required": False, "fields": [
                    {"name": "gender", "type": "select", "values": [
                        {"label": "Decline To Self Identify", "value": "3"}
                    ]}
                ]},
                {"label": "Race", "required": False, "fields": [
                    {"name": "race", "type": "select", "values": []}
                ]},
            ]}],
            "demographic_questions": {
                "questions": [
                    {"id": 1653, "label": "Gender", "required": True,
                     "type": "multi_value_single_select", "answer_options": [
                        {"id": 11748, "label": "I don't wish to answer",
                         "decline_to_answer": True}
                     ]},
                    {"id": 1655, "label": "Race", "required": True,
                     "type": "multi_value_single_select", "answer_options": [
                        {"id": 11761, "label": "I don't wish to answer",
                         "decline_to_answer": True}
                     ]},
                    {"id": 1656, "label": "Are you Hispanic/Latino?", "required": True,
                     "type": "multi_value_single_select", "answer_options": [
                        {"id": 11764, "label": "I don't wish to answer",
                         "decline_to_answer": True}
                     ]},
                ],
            },
            "data_compliance": [{"demographic_data_consent_applies": True}],
        }

        class Response:
            def raise_for_status(self):
                return None
            def json(self):
                return payload

        with patch.object(gh.requests, "get", return_value=Response()):
            fields = gh.fetch_form("company", "123")

        names = [field["fields"][0]["name"] for field in fields]
        self.assertIn("location", names)
        self.assertNotIn("longitude", names)
        self.assertIn("school--0", names)
        self.assertIn("degree--0", names)
        self.assertIn("discipline--0", names)
        self.assertIn("gender", names)
        self.assertIn("race", names)
        self.assertIn("demographic_question_1653", names)
        self.assertIn("demographic_question_1655", names)
        self.assertIn("demographic_question_1656", names)
        self.assertIn("demographic_data_consent", names)
        self.assertNotIn("hispanic_ethnicity", names)

    def test_greenhouse_submission_uses_browser_without_claiming_visible_captcha(self):
        with patch.object(submit, "detect_captcha", side_effect=AssertionError("not needed")):
            result = submit.submit_application(
                "greenhouse", "company", "123", "", [], dry_run=False,
            )
        self.assertEqual("browser_required", result["status"])
        self.assertIn("in-browser", result["detail"])

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

