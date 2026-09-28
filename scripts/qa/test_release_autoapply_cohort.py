import importlib.util
from pathlib import Path

_PATH = Path(__file__).with_name("release-autoapply-cohort.py")
_SPEC = importlib.util.spec_from_file_location("release_autoapply_cohort", _PATH)
_MODULE = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(_MODULE)
matches = _MODULE.matches


FILTERS = {
    "roles": ["swe"],
    "experience_levels": ["new_grad", "intern", "junior"],
    "exclude_keywords": ["senior", "staff", "principal", "manager", "director"],
    "us_only": True,
}


def job(title, roles=None, level="new_grad"):
    return {"title": title, "role_types": roles or ["swe"],
            "experience_level": level, "location": "San Francisco, CA"}


def test_accepts_actual_software_roles():
    assert matches(job("Software Engineer, New Grad"), FILTERS)
    assert matches(job("Backend Developer", ["swe", "backend"]), FILTERS)
    assert matches(job("Site Reliability Engineer", ["swe", "infra"]), FILTERS)


def test_rejects_classifier_default_false_positives():
    for title in ("Mechanical Engineer", "Electrical Hardware Engineer",
                  "Enterprise Solutions Engineer", "Customer Engineer",
                  "GRC Engineer", "Marketing Systems Engineer"):
        assert not matches(job(title), FILTERS), title


def test_rejects_unknown_seniority_and_degree_mismatch():
    assert not matches(job("Software Engineer", level=None), FILTERS)
    assert not matches(job("Systems PhD - Software Engineer", level=None), FILTERS)
    assert matches(job("Software Engineer, Early Career", level=None), FILTERS)


def test_rejects_excluded_seniority():
    assert not matches(job("Senior Software Engineer", level="senior"), FILTERS)
