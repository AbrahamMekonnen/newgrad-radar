import sys
from pathlib import Path
import unittest


QUESTION_DIR = Path(__file__).resolve().parents[1] / "sources" / "interview_questions"
sys.path.insert(0, str(QUESTION_DIR))

from quality import classify_question  # noqa: E402


class InterviewQuestionQualityTests(unittest.TestCase):
    def assert_kept(self, text: str) -> None:
        self.assertFalse(classify_question(text).is_junk, text)

    def assert_rejected(self, text: str, reason: str) -> None:
        self.assertEqual(classify_question(text).reason, reason, text)

    def test_keeps_real_question_formats(self):
        samples = [
            "3Sum Closest - asked at TCS (LeetCode).",
            "1. Explain the difference between a process and a thread.",
            "how would you design a URL shortener?",
            "implement a queue using two stacks",
            "文字列を反転する方法を説明してください。",
            "**Tell me about a time you disagreed with a teammate.**",
        ]
        for sample in samples:
            with self.subTest(sample=sample):
                self.assert_kept(sample)

    def test_rejects_only_strong_junk_signals(self):
        cases = {
            "": "empty",
            "Home": "too_short",
            "privacy policy": "navigation",
            "Subscribe to our system design premium course today": "marketing",
            "def helper(value): return value + 1": "code_fragment",
            "in almost every interview now": "short_sentence_fragment",
        }
        for text, reason in cases.items():
            with self.subTest(text=text):
                self.assert_rejected(text, reason)

    def test_keeps_ambiguous_context_instead_of_deleting_it(self):
        self.assert_kept(
            "Interview experience at Apple covering the phone screen and onsite rounds"
        )


if __name__ == "__main__":
    unittest.main()
