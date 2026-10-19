"""Read-only workflow checks for PermitPlate pilot release."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PilotSourceAdmissionTests(unittest.TestCase):
    def test_launch_admits_exact_main(self):
        source=(ROOT/".github/workflows/launch-readiness.yml").read_text()
        self.assertIn('test "$GITHUB_REF" = "refs/heads/main"',source)
        self.assertIn('test "$GITHUB_SHA" = "$remote_main"',source)
        self.assertLess(source.index("Admit exact current main"),source.index("Require private durable state"))
        self.assertIn("persist-credentials: false",source)

    def test_detection_admits_exact_main(self):
        source=(ROOT/".github/workflows/detection-ledger.yml").read_text()
        self.assertIn('test "$GITHUB_REF" = "refs/heads/main"',source)
        self.assertIn('test -n "$CURRENT" && test "$CURRENT" = "$GITHUB_SHA"',source)
        self.assertLess(source.index("Admit exact current main"),source.index("Require private durable state"))
        self.assertIn("persist-credentials: false",source)

    def test_pinned_actions(self):
        for path in [".github/workflows/launch-readiness.yml",".github/workflows/detection-ledger.yml"]:
            source=(ROOT/path).read_text()
            self.assertNotIn("actions/checkout@v4",source)
            self.assertNotIn("actions/setup-node@v4",source)
            self.assertNotIn("actions/upload-artifact@v4",source)

    def test_pilot_checks_actual_paid_subscriber_monitoring(self):
        launch=(ROOT/".github/workflows/launch-readiness.yml").read_text()
        intake=(ROOT/".github/workflows/stripe-onboarding.yml").read_text()
        controller=(ROOT/"pipeline/launch-readiness.js").read_text()
        runner=(ROOT/"pipeline/run-launch-readiness.js").read_text()
        self.assertIn(
            "PERMITPLATE_STRIPE_ONBOARDING_ENABLED: ${{ vars.PERMITPLATE_STRIPE_ONBOARDING_ENABLED }}",
            launch)
        self.assertIn("vars.PERMITPLATE_STRIPE_ONBOARDING_ENABLED == 'true'",intake)
        self.assertIn("stripeIntakeMonitoringVerified",controller)
        self.assertIn("curated-onboarding-ledger.json",runner)
        self.assertIn("curated-onboarding-anchor.json",runner)
        self.assertIn("stripe-intake-readiness.test.js",launch)
        self.assertIn("ENABLE_AND_VERIFY_READ_ONLY_STRIPE_SUBSCRIBER_POLL",controller)

    def test_branch_selection_cannot_enter_pilot_private_jobs(self):
        for path in [".github/workflows/launch-readiness.yml",".github/workflows/detection-ledger.yml"]:
            source=(ROOT/path).read_text()
            self.assertIn("github.ref == 'refs/heads/main'",source)

if __name__=="__main__":
    unittest.main()
