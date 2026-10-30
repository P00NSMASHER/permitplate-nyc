"""Adversarial policy for the external x402 distribution workflow."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github" / "workflows" / "post-floot-x402-distribution.yml"

CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
UPLOAD = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
LIVE_IF = (
    "if: ${{ github.ref == 'refs/heads/main' && "
    "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}"
)
SHA_ASSERTION = 'test "$GITHUB_SHA" = "$remote_main"'
MUTATION_SCRIPT = "node scripts/repair-marketplaces-after-floot-rehost.mjs"


def validate_policy(source: str) -> None:
    """Reject any branch-selected path to external marketplace mutation."""
    assert "  pull_request:\n" in source
    assert "permissions: {}\n" in source
    assert "  policy:\n" in source
    assert "    needs: policy\n" in source
    assert LIVE_IF in source
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in source
    assert 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in source
    assert "git ls-remote --exit-code origin refs/heads/main" in source
    assert SHA_ASSERTION in source

    admission = source.index("- name: Admit exact current main before external mutation")
    first_mutation = source.index(MUTATION_SCRIPT)
    assert admission < first_mutation

    policy = source[source.index("  policy:\n"):source.index("  distribute:\n")]
    assert "scripts/" not in policy
    assert "test_post_floot_distribution_workflow_policy.py" in policy

    assert source.count(CHECKOUT) == 2
    assert source.count("persist-credentials: false") == 2
    assert SETUP_NODE in source
    assert UPLOAD in source
    assert "actions/checkout@v4" not in source
    assert "actions/setup-node@v4" not in source
    assert "actions/upload-artifact@v4" not in source
    assert "contents: write" not in source
    assert "post-floot-x402-distribution-${{ github.sha }}" in source
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in source


class PostFlootDistributionWorkflowPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = FLOW.read_text(encoding="utf-8")

    def test_current_workflow_is_exact_main_before_external_mutation(self) -> None:
        validate_policy(self.source)

    def test_branch_selectable_live_job_is_rejected(self) -> None:
        weakened = self.source.replace(
            LIVE_IF, "if: ${{ github.event_name != 'pull_request' }}"
        )
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_removed_remote_main_comparison_is_rejected(self) -> None:
        weakened = self.source.replace(SHA_ASSERTION, 'test -n "$remote_main"')
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_mutation_before_admission_is_rejected(self) -> None:
        marker = "- name: Admit exact current main before external mutation"
        weakened = self.source.replace(marker, f"# {MUTATION_SCRIPT}\n      {marker}", 1)
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_mutable_action_and_persisted_credentials_are_rejected(self) -> None:
        weakened = self.source.replace(CHECKOUT, "actions/checkout@v4", 1)
        weakened = weakened.replace("persist-credentials: false", "persist-credentials: true", 1)
        with self.assertRaises(AssertionError):
            validate_policy(weakened)


if __name__ == "__main__":
    unittest.main()
