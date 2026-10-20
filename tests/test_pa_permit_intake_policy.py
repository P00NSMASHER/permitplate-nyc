"""PA private order intake: protect source trust, privacy and no-send."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FLOW=ROOT/".github/workflows/pa-permit-intake.yml"
PINNED_CHECKOUT="actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
PINNED_NODE="actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"

def verify(source):
    assert "vars.PERMITPLATE_PA_ORDER_INTAKE_ENABLED == 'true'" in source
    assert "github.ref == 'refs/heads/main'" in source
    assert "schedule:" in source and "workflow_dispatch:" in source
    assert "pull_request:" in source and "branches: [main]" in source
    assert "permissions:\n  contents: read" in source
    assert "contents: write" not in source
    assert "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)" in source
    assert "cancel-in-progress:" in source and "github.event_name == 'pull_request'" in source
    assert source.count(PINNED_CHECKOUT)==3
    assert source.count(PINNED_NODE)==2
    assert source.count("persist-credentials: false")==3
    assert "actions/checkout@v4" not in source
    assert "actions/setup-node@v4" not in source
    assert source.index("Admit current exact main before loading private credentials") < source.index(
        "secrets.PERMITPLATE_STATE_TOKEN")
    assert source.index("Admit current exact main before loading private credentials") < source.index(
        "secrets.PERMITPLATE_STRIPE_READ_KEY")
    assert source.index("Recheck exact approved public source after live provider read") < source.index(
        "Commit only private PA order state")
    assert source.index("Recheck exact approved public source after live provider read") < source.index(
        "Publish private PA orders with current-main compare and swap")
    assert source.count("git ls-remote --exit-code origin refs/heads/main")==3
    assert 'gh api "repos/$STATE_REPO" --jq \'.visibility\'' in source
    assert 'test "$STATE_REPO" != "$GITHUB_REPOSITORY"' in source
    assert "state/pa-permit-orders.json state/pa-permit-anchor.json" in source
    assert "git -C \"$PRIVATE_DIR\" push origin HEAD:main" in source
    assert "node pipeline/pa-permit-orders.test.js" in source
    assert "python3 -m unittest discover -s tests -p 'test_pa_permit_intake_policy.py'" in source
    assert "node pipeline/run-pa-permit-intake.js" in source
    assert "upload-artifact" not in source
    assert "send-email" not in source.lower()
    assert "run-pa-permit-workbench.js" not in source
    assert "PERMITPLATE_RESEND_READ_KEY" not in source
    assert "stripe_api_write" not in source
    assert "POST https://api.stripe.com" not in source
    assert "force-push" not in source.lower()
    assert "workflow_dispatch:\n    inputs:" not in source

class PaidOrderPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.src=FLOW.read_text(encoding="utf8")
    def test_policy(self):verify(self.src)
    def test_not_unconditionally_enabled(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace("vars.PERMITPLATE_PA_ORDER_INTAKE_ENABLED == 'true'","true"))
    def test_no_pr_credentials(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace("github.ref == 'refs/heads/main'","github.ref != 'refs/heads/main'"))
    def test_no_public_state_artifact(self):
        with self.assertRaises(AssertionError):verify(self.src+"\n  upload-artifact: true\n")
    def test_no_wrong_destination(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace("format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)","github.ref"))
    def test_no_unpinned_source(self):
        with self.assertRaises(AssertionError):
            verify(self.src.replace(PINNED_CHECKOUT,"actions/checkout@v4",1))

if __name__=="__main__":unittest.main()
