"""Adversarial policy regression for PA Entity release QA trust boundary."""
import unittest
from pathlib import Path

FLOW = (
    Path(__file__).resolve().parents[1]
    / ".github/workflows/pa-entity-release-regression.yml"
)


class PaEntityReleaseRegressionPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = FLOW.read_text(encoding="utf-8")

    def test_only_main_push_pr_and_non_canceling_main_execution(self):
        s = self.text
        self.assertIn("  push:\n    branches: [main]\n", s)
        self.assertIn("  pull_request:", s)
        self.assertIn("  workflow_dispatch:", s)
        self.assertEqual(
            s.count("'tests/test_pa_entity_release_regression_policy.py'"), 2
        )
        self.assertIn(
            "group: pa-entity-release-regression-${{ github.event.pull_request.number || github.ref }}",
            s,
        )
        self.assertIn(
            "cancel-in-progress: ${{ github.event_name == 'pull_request' }}", s
        )
        self.assertNotIn("cancel-in-progress: true", s)

    def test_token_and_checkout_are_read_only_pinned_and_credential_free(self):
        s = self.text
        self.assertIn("permissions:\n  contents: read", s)
        self.assertNotIn("contents: write", s)
        self.assertNotIn("secrets.", s)
        self.assertIn(
            "actions/checkout@11d5960a326750d5838078e36cf38b85af677262", s
        )
        self.assertIn(
            "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020", s
        )
        self.assertIn("ref: ${{ github.event.pull_request.head.sha || github.sha }}", s)
        self.assertIn("persist-credentials: false", s)
        self.assertNotIn("actions/checkout@v4", s)
        self.assertNotIn("actions/setup-node@v4", s)

    def test_no_runtime_package_resolution(self):
        s = self.text
        self.assertNotIn("tsx@latest", s)
        self.assertNotIn("npx -y", s)
        self.assertNotIn("npm install", s)
        self.assertNotIn("npm exec", s)
        self.assertEqual(s.count("node --experimental-strip-types scripts/"), 4)

    def test_live_probe_is_main_only_after_remote_main_admission(self):
        s = self.text
        admission = s.index("Bind authoritative live probe to current main")
        live = s.index("Record current AppDeploy vendor-gate hosting status")
        self.assertLess(admission, live)
        self.assertIn('test "$GITHUB_REF" = "refs/heads/main"', s)
        self.assertIn("git ls-remote origin refs/heads/main", s)
        self.assertIn('test "$EVENT_SHA" = "$current_main"', s)
        live_block = s[live:]
        self.assertIn("if: github.event_name != 'pull_request'", live_block)
        self.assertIn("continue-on-error: true", live_block)


if __name__ == "__main__":
    unittest.main()
