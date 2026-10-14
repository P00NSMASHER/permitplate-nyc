"""Adversarial offline controls for the PayanAgent catalog inspector."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

from scripts.payanagent_catalog_safe import (
    MAX_BYTES, UnsafeCatalog, count_potential_matches,
)

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github" / "workflows" / "pa-entity-payanagent.yml"
READER = ROOT / "scripts" / "payanagent_catalog_safe.py"


class PayanAgentWorkflowPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = FLOW.read_text(encoding="utf-8")

    def test_branch_prs_only_run_offline_policy(self):
        source = self.text
        self.assertIn("branches: [main]", source)
        self.assertIn("pull_request:", source)
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("    needs: policy", source)
        self.assertIn(
            "if: ${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' }}",
            source,
        )
        policy, live = source.split("  inspect:", 1)
        self.assertNotIn("curl --request", policy)
        self.assertIn("--request GET", live)
        self.assertNotIn("workflow_call:", source)

    def test_denies_write_token_and_pins_both_checkouts(self):
        source = self.text
        self.assertIn("permissions: {}", source)
        self.assertIn("    permissions: {}", source)
        self.assertEqual(
            source.count("actions/checkout@11d5960a326750d5838078e36cf38b85af677262"),
            2,
        )
        self.assertEqual(source.count("persist-credentials: false"), 2)
        self.assertIn("ref: ${{ github.sha }}", source)
        self.assertNotIn("contents: write", source)
        self.assertNotIn("secrets.", source)
        self.assertNotIn("GITHUB_TOKEN", source)
        self.assertNotIn("GH_TOKEN", source)

    def test_no_raw_response_headers_or_provider_data_are_logged(self):
        source = self.text
        self.assertIn("--output \"$response\"", source)
        self.assertIn("sha256sum", source)
        self.assertIn("--write-out '%{http_code}'", source)
        self.assertIn("PAYAN_CATALOG_UNVERIFIED", source)
        self.assertNotIn("tee /tmp/payan.json", source)
        self.assertNotIn("curl -i", source)
        self.assertNotIn("curl -v", source)
        self.assertNotIn("cat \"$response\"", source)
        self.assertNotIn("jq '[..", source)
        self.assertNotIn("POST", source)
        self.assertNotIn("PUT", source)
        self.assertNotIn("PATCH", source)
        self.assertNotIn("DELETE", source)

    def test_fixed_target_and_bounded_request_execution(self):
        source = self.text
        self.assertEqual(source.count("https://payanagent.com/api/v1/discover"), 1)
        self.assertIn("'Pennsylvania business registry'", source)
        self.assertIn("'vendor verification Pennsylvania'", source)
        self.assertIn("'company legal entity identification'", source)
        self.assertIn("--proto '=https'", source)
        self.assertIn("--tlsv1.2", source)
        self.assertIn("--max-time 12", source)
        self.assertIn("--connect-timeout 5", source)
        self.assertIn("--max-filesize 65536", source)
        self.assertIn("--retry 0", source)
        self.assertIn("status\" != '200'", source)
        self.assertIn('size > 65536', source)
        self.assertIn("scripts/payanagent_catalog_safe.py", source)
        self.assertNotIn("inputs.", source)
        self.assertNotIn("cancel-in-progress: true", source)

    def test_valid_structured_catalog_returns_counts_not_external_claims(self):
        body = {
            "results": [
                {"endpoint": "https://pa-entity-x402.floot.app/health"},
                {"endpointUrl": "https://pa-entity-lookup-x402-4fbm4s.floot.app"},
                {"url": "https://other.example.net"},
                {"endpoint": "https://evil.test/?next=pa-entity-x402.floot.app"},
            ],
        }
        self.assertEqual(count_potential_matches(json.dumps(body).encode()), 2)
        self.assertEqual(count_potential_matches(b'{"results":[]}'), 0)

    def test_malformed_duplicate_or_oversized_payloads_fail_closed(self):
        bad = [
            b"this isn't json",
            b'"string-only"',
            b'{"url":"a","url":"b"}',
            b" ",
            b"x" * (MAX_BYTES + 1),
            json.dumps([0] * 2500).encode(),
        ]
        for value in bad:
            with self.subTest(sample=value[:20]), self.assertRaises(UnsafeCatalog):
                count_potential_matches(value)

    def test_never_credit_http_userinfo_redirect_or_unrelated_domain(self):
        values = [
            "http://pa-entity-x402.floot.app/",
            "https://user:pass@pa-entity-x402.floot.app/",
            "https://evil.test/pa-entity-x402.floot.app",
            "https://pa-entity-x402.floot.app.evil.test/",
            "https://other.example.net/",
        ]
        self.assertEqual(
            count_potential_matches(json.dumps({"results": [
                {"endpoint": value} for value in values
            ]}).encode()), 0
        )

    def test_cli_runs_only_on_single_bounded_local_file(self):
        with tempfile.TemporaryDirectory() as folder:
            allowed = Path(folder) / "response.json"
            allowed.write_text('{"results":[{"endpoint":"https://pa-entity-x402.floot.app"}]}')
            valid = subprocess.run(
                [sys.executable, str(READER), str(allowed)],
                capture_output=True, text=True, timeout=5,
            )
            self.assertEqual(valid.returncode, 0, valid.stderr)
            self.assertEqual(valid.stdout.strip(), "1")
            bad = subprocess.run(
                [sys.executable, str(READER), "https://not-a-local-file"],
                capture_output=True, text=True, timeout=5,
            )
            self.assertNotEqual(bad.returncode, 0)
            self.assertNotIn("https://not-a-local-file", bad.stderr)


if __name__ == "__main__":
    unittest.main()
