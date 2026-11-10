"""Fail-closed owner-authorized AI proxy calibration workflow trust boundaries."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github" / "workflows" / "ai-proxy-calibration.yml"
MAIN = "if: ${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}"
ADMIT = "Admit exact current main before private credentials"
SECRET = "secrets.PERMITPLATE_STATE_TOKEN"
GROUP = "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)"
PRIVATE = "research/ai-proxy-calibration/42842957840/ai-proxy-gate-result.json"


def verify(source):
    assert MAIN in source
    assert "workflow_dispatch:" in source
    assert "pull_request:" in source
    assert "permissions:\n  contents: read" in source
    assert "contents: write" not in source
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in source
    assert GROUP in source
    assert source.index(ADMIT) < source.index(SECRET)
    assert source.count('git ls-remote --exit-code origin refs/heads/main') == 3
    assert source.count('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"') == 3
    assert source.count("persist-credentials: false") == 3
    assert source.count("actions/checkout@11d5960a326750d5838078e36cf38b85af677262") == 3
    assert source.count("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020") == 2
    assert "node --test pipeline/ai-proxy-calibration.test.js" in source
    assert "node pipeline/calibration-runner.js ai-proxy-evaluate" in source
    assert "test \"$status\" = \"2\"" in source
    assert "AI_PROXY_CALIBRATION_BLOCKED" in source
    assert "report.productionAuthorized!==false" in source
    assert "report.customerDeliveryAllowed!==false" in source
    assert "report.verifiedBuyerPrecision!==null" in source
    assert "report.externalSendCalls!==0" in source
    assert PRIVATE in source
    assert "gh api \"repos/$STATE_REPO\" --jq '.visibility'" in source
    assert "test \"$STATE_REPO\" != \"$GITHUB_REPOSITORY\"" in source
    assert "git -C \"$PRIVATE_DIR\" push origin HEAD:main" in source
    assert "upload-artifact" not in source
    assert "stripe_api_write" not in source
    assert "send_email" not in source
    assert "run-curated-fulfillment" not in source
    assert "productionAuthorized:true" not in source
    assert "workflows: ['PermitPlate scoring readiness']" not in source


class AIProxyWorkflowPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FLOW.read_text(encoding="utf8")

    def test_research_private_only(self):
        verify(self.source)

    def test_no_pr_secret(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(MAIN, "if: true"))

    def test_cannot_load_secret_before_main_admission(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(ADMIT, SECRET + "\n      - name: " + ADMIT, 1))

    def test_no_public_simulated_customer_leads(self):
        with self.assertRaises(AssertionError):
            verify(self.source + "\n      - name: upload-artifact private cohort\n")

    def test_no_fake_green_proxy(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace('test "$status" = "2"', 'test "$status" = "0"'))

    def test_no_false_production_promotion(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace("report.productionAuthorized!==false",
                                       "report.productionAuthorized!==true"))

    def test_private_concurrency_cannot_split(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(GROUP, "github.ref"))


if __name__ == "__main__":
    unittest.main()
