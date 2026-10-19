"""No-live-secrets-on-PR policy for PermitPlate checkout intake."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github/workflows/stripe-onboarding.yml"
MAIN = "github.ref == 'refs/heads/main'"
OPT_IN = "vars.PERMITPLATE_STRIPE_ONBOARDING_ENABLED == 'true'"
PRIVATE_TOKEN = "secrets.PERMITPLATE_STATE_TOKEN"
STRIPE_TOKEN = "secrets.PERMITPLATE_STRIPE_READ_KEY"
SOURCE_GATE = "Admit current exact main before loading private credentials"
SOURCE_RECHECK = "Recheck exact approved public source after Stripe read"
PUBLISH = "Publish private onboarding with current-main compare and swap"
PINNED_CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
PINNED_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"


def verify(source):
    assert MAIN in source
    assert OPT_IN in source
    assert "schedule:" in source
    assert "permissions:\n  contents: read" in source
    assert "contents: write" not in source
    assert "cancel-in-progress: \${{ github.event_name == 'pull_request' }}" in source
    assert "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)" in source
    assert source.index(SOURCE_GATE) < source.index(PRIVATE_TOKEN)
    assert source.index(SOURCE_GATE) < source.index(STRIPE_TOKEN)
    assert source.index(SOURCE_RECHECK) < source.index("Commit only private onboarding state")
    assert source.index(SOURCE_RECHECK) < source.index(PUBLISH)
    assert "test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"" in source
    assert source.count('git ls-remote --exit-code origin refs/heads/main') == 3
    assert source.count(PINNED_CHECKOUT) == 3
    assert source.count(PINNED_NODE) == 2
    assert source.count("persist-credentials: false") == 3
    assert "actions/checkout@v4" not in source
    assert "actions/setup-node@v4" not in source
    assert "gh api \"repos/$STATE_REPO\" --jq '.visibility'" in source
    assert "test \"$STATE_REPO\" != \"$GITHUB_REPOSITORY\"" in source
    assert "node pipeline/curated-stripe-onboarding.test.js" in source
    assert "node pipeline/run-curated-stripe-onboarding.js" in source
    assert "state/curated-onboarding-ledger.json state/curated-onboarding-anchor.json" in source
    assert "git -C \"$PRIVATE_DIR\" push origin HEAD:main" in source
    assert "upload-artifact" not in source
    assert "workflow_dispatch:\n    inputs:" not in source
    assert "POST https://api.stripe.com" not in source
    assert "send_email" not in source
    assert "stripe_api_write" not in source
    assert "node pipeline/run-curated-fulfillment.js" not in source


class OnboardingPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FLOW.read_text(encoding="utf-8")

    def test_exact_source(self):
        verify(self.source)

    def test_no_branch_selected_private_intake(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(MAIN, "github.ref != 'refs/heads/main'"))

    def test_no_unapproved_activation(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(OPT_IN, "true"))

    def test_no_secret_before_main(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(SOURCE_GATE, "# " + STRIPE_TOKEN + "\n      - name: " + SOURCE_GATE, 1))

    def test_no_pub_privacy_leak(self):
        with self.assertRaises(AssertionError):
            verify(self.source + "\n      - name: upload-artifact subscriber data\n")

    def test_no_private_public_state_fork(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace("format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)", "github.ref"))
if __name__ == "__main__":
    unittest.main()
