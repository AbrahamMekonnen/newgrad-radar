import unittest
from autoapply.shared_question_policy import POLICY_VERSION, classify_application_question

class SharedQuestionPolicyTests(unittest.TestCase):
    def test_contract_version(self):
        self.assertEqual(1, POLICY_VERSION)

    def test_cross_language_cases(self):
        cases = {
            "How did you hear about Twilio?": "source",
            "Have you ever worked at MongoDB before?": "previous_employment",
            "Are you currently located in Estonia?": "location_confirmation",
            "What is your highest degree?": "degree",
            "Will you require visa sponsorship?": "sponsorship",
            "Describe a project you are proud of.": "prose",
        }
        for label, expected in cases.items():
            with self.subTest(label=label):
                self.assertEqual(expected, classify_application_question(label)["id"])

    def test_legal_acknowledgement_is_never_ai(self):
        rule = classify_application_question("Applicant Arbitration Agreement Acknowledgement")
        self.assertTrue(rule["sensitive"])
        self.assertEqual("confirmed_fact", rule["resolution"])

if __name__ == "__main__":
    unittest.main()