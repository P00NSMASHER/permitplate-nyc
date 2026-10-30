"""Adversarial policy regression for the Floot live-upstream trust boundary."""
import unittest
from pathlib import Path

FLOW = (
    Path(__file__).resolve().parents[1]
    / ".github/workflows/test-floot-release-live-upstreams.yml"
)


class FlootLiveUpstreamPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = FLOW.read_text(encoding="utf-8")

    def test_candidate_validation_is_offline_and_push_is_main_only(self):
        s = self.text
        self.assertIn("  push:\n    branches: [main]\n", s)
        self.assertIn("  pull_request:", s)
        self.assertIn("  workflow_dispatch:", s)
        self.assertEqual(
            s.count("'tests/test_floot_live_upstream_policy.py'"), 2
        )
        policy = s[s.index("  policy:"):s.index("  live-upstreams:")]
        self.assertNotIn("test-floot-release-live-upstreams.mts", policy)

    def test_live_probe_is_not_admitted_for_pull_requests_or_selected_branches(self):
        s = self.text
        live = s[s.index("  live-upstreams:"):]
        self.assertIn(
            "if: github.event_name != 'pull_request' && github.ref == 'refs/heads/main'",
            live,
        )
        self.assertIn('test "$GITHUB_REF" = "refs/heads/main"', live)
        self.assertIn("git ls-remote --exit-code origin refs/heads/main", live)
        self.assertIn('test "$EVENT_SHA" = "$current_main"', live)

    def test_checkout_and_runtime_are_immutable_and_credential_free(self):
        s = self.text
        self.assertEqual(
            s.count("actions/checkout@11d5960a326750d5838078e36cf38b85af677262"),
            2,
        )
        self.assertIn(
            "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
            s,
        )
        self.assertEqual(
            s.count("ref: ${{ github.event.pull_request.head.sha || github.sha }}"),
            2,
        )
        self.assertEqual(s.count("persist-credentials: false"), 2)
        self.assertNotIn("actions/checkout@v4", s)
        self.assertNotIn("actions/setup-node@v4", s)

    def test_no_mutable_runtime_package_download(self):
        s = self.text
        self.assertNotIn("npx -y", s)
        self.assertNotIn("tsx@latest", s)
        self.assertNotIn("npm install", s)
        self.assertIn(
            "node --experimental-strip-types scripts/test-floot-release-live-upstreams.mts",
            s,
        )

    def test_least_privilege_and_source_scoped_concurrency(self):
        s = self.text
        self.assertIn("permissions:\n  contents: read", s)
        self.assertNotIn("contents: write", s)
        self.assertNotIn("secrets.", s)
        self.assertIn(
            "group: floot-live-upstreams-${{ github.event.pull_request.number || github.ref }}",
            s,
        )
        self.assertIn(
            "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
            s,
        )


if __name__ == "__main__":
    unittest.main()
