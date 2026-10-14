"""Offline regression for the reviewer-fixture GitHub Actions trust boundary."""
import re
import unittest
from pathlib import Path

FLOW = (Path(__file__).resolve().parents[1] /
        ".github/workflows/test-floot-vendor-gate-reviewer-fixtures.yml")


class VendorFixtureCiPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = FLOW.read_text(encoding="utf-8")

    def test_only_main_push_and_pull_requests(self):
        s = self.text
        self.assertIn("  push:\n    branches: [main]\n", s)
        self.assertIn("  pull_request:", s)
        self.assertIn("  workflow_dispatch:", s)
        self.assertEqual(s.count("'tests/test_vendor_fixture_ci_policy.py'"), 2)

    def test_read_only_token_credential_free_checkout(self):
        s = self.text
        self.assertIn("permissions:\n  contents: read", s)
        self.assertIn("actions/checkout@11d5960a326750d5838078e36cf38b85af677262", s)
        self.assertIn("persist-credentials: false", s)
        self.assertIn("github.event.pull_request.head.sha || github.sha", s)
        self.assertNotIn("contents: write", s)
        self.assertNotIn("pull-requests: write", s)
        self.assertNotIn("secrets.", s)

    def test_setup_node_is_pinned_and_original_tests_are_kept(self):
        s = self.text
        self.assertIn("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", s)
        self.assertIn("node-version: '22'", s)
        for command in (
            "node scripts/test-floot-vendor-gate-demo-wrapper.mjs",
            "node scripts/test-vendor-intake-gate-core.mjs",
            "python3 -m unittest discover -s tests -p 'test_vendor_fixture_ci_policy.py' -v",
        ):
            self.assertIn(command, s)
        self.assertNotIn("actions/checkout@v4", s)
        self.assertNotIn("actions/setup-node@v4", s)

    def test_only_pr_supersession_can_cancel_and_no_network_actions(self):
        s = self.text
        self.assertIn("github.event.pull_request.number || github.ref", s)
        self.assertIn("cancel-in-progress: ${{ github.event_name == 'pull_request' }}", s)
        self.assertNotIn("cancel-in-progress: true", s)
        self.assertNotIn("git push", s)
        self.assertNotIn("npm install", s)
        self.assertNotIn("curl ", s)
        self.assertNotIn("workflow_call:", s)
        self.assertEqual(len(re.findall(r"(?m)^\s*- uses: ", s)), 2)


if __name__ == "__main__":
    unittest.main()
