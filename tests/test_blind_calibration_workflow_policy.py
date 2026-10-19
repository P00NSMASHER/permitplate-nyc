"""Production policy for a private, real-source, no-send blind calibration kit."""
import unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[1] / ".github/workflows/blind-calibration-research.yml"
MAIN_ONLY = "if: ${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}"
ADMISSION = "Admit exact current main before private credentials"
RECHECK = "Recheck exact current main after research before private commit"
PUBLISH = "Publish only protected private calibration evidence"
SECRET = "secrets.PERMITPLATE_STATE_TOKEN"
CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"


def verify(s):
    assert MAIN_ONLY in s
    assert "schedule:" in s
    assert "pull_request:" in s
    assert "permissions:\n  contents: read" in s
    assert "contents: write" not in s
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in s
    assert "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)" in s
    assert s.index(ADMISSION) < s.index(SECRET)
    assert s.index(RECHECK) < s.index("Stage only private calibration packet and pointer")
    assert s.index(RECHECK) < s.index(PUBLISH)
    assert s.count("git ls-remote --exit-code origin refs/heads/main") == 3
    assert s.count('test "$(git rev-parse HEAD)" = "$GITHUB_SHA"') == 3
    assert s.count(CHECKOUT) == 2
    assert s.count(NODE) == 2
    assert s.count("persist-credentials: false") == 2
    assert "actions/checkout@v4" not in s and "actions/setup-node@v4" not in s
    assert 'gh api "repos/$STATE_REPO" --jq \'.visibility\'' in s
    assert 'test "$STATE_REPO" != "$GITHUB_REPOSITORY"' in s
    assert "node --test pipeline/calibration.test.js pipeline/calibration-integrity.test.js pipeline/calibration-cli.test.js" in s
    assert 'node pipeline/calibration-runner.js prepare "$CALIBRATION_DIR"' in s
    assert "cohort.validateCohort(operator)" in s
    assert "packet.cards.some(card=>'predictions' in card" in s
    assert "blocked.status!=='BLOCKED'" in s
    assert "operator.sourceRevision!==process.env.GITHUB_SHA" in s
    assert "summary.productionStateWrites!==0" in s
    assert "summary.externalSendCalls!==0" in s
    assert "AWAITING_REAL_INDEPENDENT_LABELS" in s
    assert "research/blind-calibration/LATEST.json" in s
    assert "git -C \\"$PRIVATE_DIR\\" push origin HEAD:main" in s
    assert "upload-artifact" not in s
    assert "workflow_dispatch:\n    inputs:" not in s
    assert "node pipeline/run-curated-fulfillment" not in s
    assert "stripe_api_write" not in s
    assert "send_email" not in s


class BlindCalibrationPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FLOW.read_text(encoding="utf8")

    def test_policy(self):
        verify(self.source)

    def test_pull_request_cannot_read_private_data(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(MAIN_ONLY, "if: true", 1))

    def test_cannot_load_private_token_before_main(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(ADMISSION, SECRET + "\n      - name: " + ADMISSION, 1))

    def test_cannot_skip_post_research_public_head_check(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(RECHECK, "No public source check", 1))

    def test_private_calibration_only(self):
        with self.assertRaises(AssertionError):
            verify(self.source + "\n      - name: upload-artifact cohort outside private Git\n")

    def test_workflow_cannot_share_unsanitized_model_scores(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace("packet.cards.some(card=>'predictions' in card", "false"))

    def test_correct_private_state_serialization(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(
                "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)",
                "github.ref"))


if __name__ == "__main__":
    unittest.main()
