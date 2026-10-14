"""Offline contract for the public NoHumans claim inspector.

A branch-owned PR must not be able to run live vendor discovery, claim a
listing, get token privileges, expose HTTP headers/bodies, or disable policy CI.
"""
import re
import unittest
from pathlib import Path

FLOW = (Path(__file__).resolve().parents[1] /
        ".github/workflows/pa-entity-nohumans-claim-inspect.yml")

class NoHumansClaimInspectorPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = FLOW.read_text(encoding="utf-8")

    def test_live_claim_network_is_main_only_and_manual_cannot_use_branch(self):
        text = self.text
        self.assertIn("branches: [main]", text)
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("pull_request:", text)
        self.assertRegex(text, r"(?m)^  inspect:\n    needs: policy\n    if: .*github.ref == 'refs/heads/main'.*github.event_name != 'pull_request'")
        self.assertEqual(len(re.findall(r"(?m)^\s*curl\b", text)), 0)
        self.assertEqual(len(re.findall(r"\bcurl\b", text)), 1)

    def test_no_permissions_secrets_or_persisted_credentials(self):
        text = self.text
        self.assertEqual(len(re.findall(r"(?m)^permissions: \{\}$", text)), 1)
        self.assertIn("    permissions: {}", text)
        self.assertIn("persist-credentials: false", text)
        self.assertIn("actions/checkout@11d5960a326750d5838078e36cf38b85af677262", text)
        self.assertNotIn("secrets.", text)
        self.assertNotIn("GH_TOKEN", text)
        self.assertNotIn("GITHUB_TOKEN", text)
        self.assertNotIn("contents: write", text)

    def test_pr_checks_are_offline_replay_and_main_not_cancelled(self):
        text = self.text
        self.assertIn("name: Validate no-send and main-only claim inspector", text)
        self.assertIn("test_nohumans_claim_workflow_policy.py", text)
        self.assertIn("github.event_name == 'pull_request'", text)
        self.assertIn("    needs: policy", text)
        self.assertNotIn("cancel-in-progress: true", text)

    def test_vendor_request_stays_readonly_bounded_and_non_disclosing(self):
        text = self.text
        self.assertIn("--request GET", text)
        self.assertIn("--proto '=https'", text)
        self.assertIn("--tlsv1.2", text)
        self.assertIn("--connect-timeout 5", text)
        self.assertIn("--max-time 12", text)
        self.assertIn("--output \"$body\"", text)
        self.assertIn("--write-out '%{http_code}'", text)
        self.assertIn('if [[ "$status" != \'200\' ]]', text)
        self.assertIn("size > 32768", text)
        self.assertIn("json.load(source)", text)
        self.assertIn("sha256sum", text)
        self.assertNotIn("curl -i", text)
        self.assertNotIn("head -c", text)
        self.assertNotIn("cat \"$body\"", text)
        self.assertNotIn("POST", text)
        self.assertNotIn("PUT", text)
        self.assertNotIn("PATCH", text)
        self.assertNotIn("DELETE", text)

    def test_fixed_targets_and_no_caller_supplied_external_destination(self):
        text = self.text
        self.assertIn("958fd262-287 9f2f7a33-cb2", text)
        self.assertIn("https://api.nohumans.directory/v1/listings/$listing_id/claim", text)
        self.assertNotIn("inputs.", text)
        self.assertNotIn("workflow_call:", text)

if __name__ == "__main__":
    unittest.main()
