"""Adversarial offline policy for the private paid-product research workflow."""
import unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'curated-research.yml'
MAIN_ONLY = "if: ${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}"
AFTER_REFRESH = "Recheck exact public main after collection"
PUBLIC_SOURCE = 'current_public="$(git ls-remote --exit-code origin refs/heads/main | cut -f1)"'
PUBLIC_EQUAL = 'test -n "$current_public" && test "$current_public" = "$GITHUB_SHA"'
COMMIT = "Publish private state with scoped credentials"
SECRET = "secrets.PERMITPLATE_STATE_TOKEN"


def verify(source):
    assert MAIN_ONLY in source
    assert "Admit exact current main before private credential" in source
    assert source.index("Admit exact current main before private credential") < source.index(SECRET)
    assert "test \"$GITHUB_REF\" = \"refs/heads/main\"" in source
    assert "test \"$(git rev-parse HEAD)\" = \"$GITHUB_SHA\"" in source
    assert 'test -n "$current" && test "$current" = "$GITHUB_SHA"' in source
    assert "gh api \"repos/$STATE_REPO\" --jq '.visibility'" in source
    assert 'test "$STATE_REPO" != "$GITHUB_REPOSITORY"' in source
    assert "persist-credentials: false" in source
    assert source.count("persist-credentials: false") == 3
    assert "actions/checkout@11d5960a326750d5838078e36cf38b85af677262" in source
    assert "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020" in source
    assert "actions/checkout@v4" not in source
    assert "contents: write" not in source
    assert "permissions:\n  contents: read" in source
    assert "format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)" in source
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in source
    assert "Test actual paid product with offline fixtures" in source
    assert "node pipeline/curated-product.test.js" in source
    assert "state/curated-research-ledger.json state/curated-current-graph.json" in source
    assert "state/identity-bridge-review.json state/identity-triage-history.json state/identity-bridge-review.csv state/identity-bridge-review.html" in source
    assert "node pipeline/identity-triage-history.test.js" in source
    assert "node pipeline/construction-validation-panel.test.js" in source
    assert "node pipeline/construction-blind-diagnostic.test.js" in source
    assert "'pipeline/construction-frozen-reference.js'" in source
    assert "research/construction-frozen-reference-v1" in source
    assert "state/construction-blind-reviewer.json state/construction-reserved-audit.json state/construction-blind-manifest.json" in source
    assert "pipeline/calibration-cohort.js" not in source
    assert "state/construction-validation-panel.json state/construction-validation-panel.csv state/construction-validation-summary.md" in source
    assert "node pipeline/calibration-runner.js" not in source
    assert "node pipeline/identity-receipt-recovery.test.js" in source
    assert source.index("Refresh current official research in private state") < source.index(AFTER_REFRESH)
    assert source.index(AFTER_REFRESH) < source.index("Commit only private research state")
    assert source.count(PUBLIC_SOURCE) == 2
    assert source.count(PUBLIC_EQUAL) == 2
    publish = source[source.index(COMMIT):]
    assert publish.index(PUBLIC_SOURCE) < publish.index("gh auth setup-git")
    assert publish.index(PUBLIC_EQUAL) < publish.index("gh auth setup-git")
    assert source.index("Commit only private research state") < source.index(COMMIT)
    assert "git -C \"$PRIVATE_DIR\" push origin HEAD:main" in source
    assert "upload-artifact" not in source
    assert "node pipeline/run-curated-fulfillment" not in source


class CuratedWorkflowPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = FLOW.read_text(encoding='utf8')

    def test_current_policy(self):
        verify(self.source)

    def test_branch_dispatch_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace(MAIN_ONLY,"if: ${{ github.event_name != 'pull_request' }}"))

    def test_secret_before_current_main_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace("Admit exact current main before private credential",
                                       "# " + SECRET + "\n      - name: Admit exact current main before private credential",1))

    def test_checkout_credentials_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace("persist-credentials: false","persist-credentials: true",1))

    def test_private_state_serialization_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.source.replace("format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)",
                                       "github.ref"))

    def test_post_refresh_drift_is_rejected(self):
        tail = self.source.index(AFTER_REFRESH)
        modified = self.source[:tail] + self.source[tail:].replace(
            PUBLIC_SOURCE, 'current_public="$GITHUB_SHA"', 1)
        with self.assertRaises(AssertionError):
            verify(modified)

    def test_pre_push_drift_is_rejected(self):
        idx = self.source.index(COMMIT)
        modified = self.source[:idx] + self.source[idx:].replace(
            PUBLIC_SOURCE, 'current_public="$GITHUB_SHA"', 1)
        with self.assertRaises(AssertionError):
            verify(modified)

    def test_public_sensitive_artifact_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.source + "\n      - name: upload-artifact sensitive state\n")


if __name__ == '__main__':
    unittest.main()
