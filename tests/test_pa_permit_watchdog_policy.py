"""Independent PA private-state watchdog policy regression tests."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FLOW=ROOT/".github/workflows/pa-permit-watchdog.yml"
CHECKOUT="actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
NODE="actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
GATE="Admit exact current main before loading any private credentials"
PRIVATE="secrets.PERMITPLATE_STATE_TOKEN"
SOURCE="github.ref == 'refs/heads/main'"

def verify(s):
    assert "name: PermitPlate PA independent order watchdog" in s
    assert "schedule:" in s and "workflow_dispatch:" in s
    assert "pull_request:" in s and "push:" in s
    assert "permissions:\n  contents: read" in s
    assert "contents: write" not in s
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in s
    assert "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)" in s
    assert SOURCE in s
    assert s.count(CHECKOUT)==3
    assert s.count(NODE)==2
    assert s.count("persist-credentials: false")==3
    assert "actions/checkout@v4" not in s and "actions/setup-node@v4" not in s
    assert "node pipeline/pa-permit-watchdog.test.js" in s
    assert "test_pa_permit_watchdog_policy.py" in s
    assert GATE in s
    assert s.index(GATE)<s.index(PRIVATE)
    assert s.index(GATE)<s.index("repository: ${{ vars.PERMITPLATE_STATE_REPO }}")
    assert 'test "$STATE_REPO" != "$GITHUB_REPOSITORY"' in s
    assert 'gh api "repos/$STATE_REPO" --jq \'.visibility\'' in s
    assert '= "private"' in s
    assert s.count("git ls-remote --exit-code origin refs/heads/main")==2
    assert "Recheck exact current main before private state analysis" in s
    assert "vars.PERMITPLATE_PA_ORDER_INTAKE_ENABLED" in s
    assert "state/pa-permit-orders.json" in s
    assert "state/pa-permit-anchor.json" in s
    assert "node pipeline/run-pa-permit-watchdog.js" in s
    assert "upload-artifact" not in s
    assert "PERMITPLATE_STRIPE_READ_KEY" not in s
    assert "PERMITPLATE_PA_FINANCIAL_READ_KEY" not in s
    assert "PERMITPLATE_RESEND_READ_KEY" not in s
    assert "git push" not in s and 'git -C "$PRIVATE_DIR" add' not in s
    assert "POST https://" not in s and "contents: write" not in s
    assert "send-email" not in s.lower() and "customer_details" not in s
    assert "workflow_dispatch:\n    inputs:" not in s

class WatchdogPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.src=FLOW.read_text(encoding="utf8")
    def test_policy(self):
        verify(self.src)
    def test_current_main_is_required(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace(SOURCE,"true"))
    def test_unpinned_checkout_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace(CHECKOUT,"actions/checkout@v4",1))
    def test_no_credentials_before_main(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace(GATE,"# skipped source gate"))
    def test_private_repo_check_required(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace('= "private"','= "public"'))
    def test_no_public_artifact(self):
        with self.assertRaises(AssertionError):
            verify(self.src+" \n      - uses: actions/upload-artifact@v4")
    def test_no_write_or_provider_credentials(self):
        with self.assertRaises(AssertionError):
            verify(self.src+"\n  contents: write\n  PERMITPLATE_STRIPE_READ_KEY: secret")
    def test_no_unprotected_private_crossrun(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace(
                "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)",
                "github.sha"))

if __name__=="__main__":
    unittest.main()
