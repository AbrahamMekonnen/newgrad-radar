import sys
import unittest
from pathlib import Path
from unittest.mock import patch


AUTOAPPLY = Path(__file__).resolve().parents[1] / "autoapply"
sys.path.insert(0, str(AUTOAPPLY))

from submit import submit_application  # noqa: E402


class SubmissionTruthTests(unittest.TestCase):
    def test_captcha_free_server_path_is_handed_to_visible_browser(self):
        fields = [{"name": "first_name", "label": "First name", "required": True,
                   "value": "Abraham", "source": "profile"}]
        with patch("submit.detect_captcha", return_value=(False, "no captcha markers found")), \
             patch("submit.requests.post") as post:
            result = submit_application(
                "lever", "company", "job-id", "https://jobs.lever.co/company/job-id/apply",
                fields, dry_run=False,
            )

        self.assertEqual(result["status"], "browser_required")
        post.assert_not_called()

    def test_incomplete_form_never_reaches_submission_detection(self):
        fields = [{"name": "first_name", "label": "First name", "required": True,
                   "value": "", "source": "user_needed"}]
        with patch("submit.detect_captcha") as detect:
            result = submit_application(
                "lever", "company", "job-id", "https://jobs.lever.co/company/job-id/apply",
                fields, dry_run=False,
            )

        self.assertEqual(result["status"], "incomplete")
        detect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
