"""Adversarial offline policy for the private paid-product research workflow."""
import unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[1] / '.github' / 'workflows' / 'curated-research.yml'
MAIN_ONLY = "if: ${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}"
POST_REFRESH = "Recheck exact current public main after collection"
COMMIT = "Publish private state with scoped credentials"
SECRET = "secrets.PERMITPLATE_STATE_TOKEN"
PUBLIC_HEAD = 'current_public="$(git ls-remote --exit-code origin refs/heads/main | cut -f1)"'
PUBLIC_MATCH = 'test -n "$current_public" && test "$current_public" = "$GITHUB_SHA"'


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
    assert source.index("Refresh current official research in private state") < source.index(POST_REFRESH)
    assert source.index(POST_REFRESH) < source.index("Commit only private research state")
    assert source.count(PUBLIC_HEAD) == 2
    assert source.count(PUBLIC_MATCH) == 2
    publish = source[source.index(COMMIT):]
    assert publish.index(PUBLIC_HEAD) < publish.index("gh auth setup-git")
    assert publish.index(PUBLIC_MATCH) < publish.index("gh auth setup-git")
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

    def test_post_refresh_public_source_drift_rejected(self):
        post_refresh_at = self.source.index(POST_REFRESH)
        mutated = self.source[:post_refresh_at] + self.source[post_refresh_at:].replace(
            PUBLIC_HEAD, 'current_public="$GITHUB_SHA"', 1)
        with self.assertRaises(AssertionError):
            verify(mutated)

    def test_pre_push_public_source_drift_rejected(self):
        publish_at = self.source.index(COMMIT)
        mutated = self.source[:publish_at] + self.source[publish_at:].replace(
            PUBLIC_HEAD, 'current_public="$GITHUB_SHA"', 1)
        with self.assertRaises(AssertionError):
            verify(mutated)

    def test_public_sensitive_artifact_rejected(self):
        with self.assertRaises(AssertionError):
            verify(self.source + "\n      - name: upload-artifact sensitive state\n")


if __name__ == '__main__':
    unittest.main()
