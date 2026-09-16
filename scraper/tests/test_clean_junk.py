import sys
from pathlib import Path
import unittest


QUESTION_DIR = Path(__file__).resolve().parents[1] / "sources" / "interview_questions"
sys.path.insert(0, str(QUESTION_DIR))

from clean_junk import FILTER_VERSION, restore, review  # noqa: E402


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.after_id = None
        self.max_rows = None
        self.patch = None
        self.ids = None

    def select(self, *_args):
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def gt(self, _field, value):
        self.after_id = value
        return self

    def order(self, *_args):
        return self

    def limit(self, value):
        self.max_rows = value
        return self

    def update(self, patch):
        self.patch = patch
        return self

    def in_(self, _field, ids):
        self.ids = set(ids)
        return self

    def execute(self):
        if self.patch is not None:
            for row in self.rows:
                if row["id"] in self.ids:
                    row.update(self.patch)
            return FakeResult([])
        selected = [
            row.copy()
            for row in self.rows
            if all(row.get(field) == value for field, value in self.filters)
            and (self.after_id is None or row["id"] > self.after_id)
        ]
        selected.sort(key=lambda row: row["id"])
        return FakeResult(selected[: self.max_rows])


class FakeClient:
    def __init__(self, rows):
        self.rows = rows

    def table(self, _name):
        return FakeQuery(self.rows)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            self.row("01", "in almost every interview now"),
            self.row("02", "How would you design a URL shortener?"),
            self.row("03", "Subscribe to our premium course"),
            self.row("04", "another scraped fragment", verified=True),
            self.row("05", "def helper(value): return value"),
        ]
        self.client = FakeClient(self.rows)

    @staticmethod
    def row(row_id, text, verified=False):
        return {
            "id": row_id,
            "question_text": text,
            "question_type": "other",
            "source_name": "fixture",
            "is_verified": verified,
            "is_duplicate": False,
            "is_junk": False,
            "junk_reason": None,
            "quality_checked_at": None,
            "quality_filter_version": None,
        }

    def test_apply_uses_stable_pagination_and_protects_verified_rows(self):
        result = review(self.client, apply=True, page_size=2)
        self.assertEqual(result["scanned"], 5)
        self.assertEqual(result["flagged"], 3)
        self.assertEqual(result["protected_verified"], 1)
        self.assertEqual(
            [row["id"] for row in self.rows if row["is_junk"]],
            ["01", "03", "05"],
        )
        self.assertTrue(all(not row["is_duplicate"] for row in self.rows))

    def test_restore_only_requested_filter_version(self):
        review(self.client, apply=True, page_size=2)
        self.rows[0]["quality_filter_version"] = "older-version"
        restored = restore(self.client, FILTER_VERSION, page_size=2)
        self.assertEqual(restored, 2)
        self.assertTrue(self.rows[0]["is_junk"])
        self.assertFalse(self.rows[2]["is_junk"])
        self.assertFalse(self.rows[4]["is_junk"])


if __name__ == "__main__":
    unittest.main()
