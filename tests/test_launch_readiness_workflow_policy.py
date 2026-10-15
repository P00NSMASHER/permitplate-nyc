"""Adversarial offline policy for the private-state launch-readiness workflow."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github" / "workflows" / "launch-readiness.yml"

CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
UPLOAD = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
LIVE_IF = (
    "if: ${{ github.ref == 'refs/heads/main' && "
    "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}"
)
SHA_ASSERTION = 'test "$GITHUB_SHA" = "$remote_main"'
SECRET = "secrets.PERMITPLATE_STATE_TOKEN"


def validate_policy(source: str) -> None:
    """Fail closed if branch source can reach the private-state credential."""
    assert "  pull_request:\n" in source
    assert "  policy:\n" in source
    assert "    needs: policy\n" in source
    assert LIVE_IF in source
    assert SHA_ASSERTION in source
    assert 'test "$GITHUB_REF" = "refs/heads/main"' in source
    assert 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in source
    assert "git ls-remote --exit-code origin refs/heads/main" in source

    admission = source.index("- name: Admit exact current main before private credential")
    first_secret = source.index(SECRET)
    assert admission < first_secret

    assert source.count(CHECKOUT) == 3
    assert source.count("persist-credentials: false") == 3
    assert SETUP_NODE in source
    assert UPLOAD in source
    assert "actions/checkout@v4" not in source
    assert "actions/setup-node@v4" not in source
    assert "actions/upload-artifact@v4" not in source
    assert "contents: write" not in source
    assert "permitplate-launch-readiness-${{ github.sha }}" in source
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in source


class LaunchReadinessWorkflowPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = FLOW.read_text(encoding="utf-8")

    def test_current_workflow_is_exact_main_before_secret(self) -> None:
        validate_policy(self.source)

    def test_branch_selectable_live_job_mutation_is_rejected(self) -> None:
        weakened = self.source.replace(
            LIVE_IF, "if: ${{ github.event_name != 'pull_request' }}"
        )
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_removed_remote_main_comparison_is_rejected(self) -> None:
        weakened = self.source.replace(SHA_ASSERTION, 'test -n "$remote_main"')
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_mutable_action_and_persisted_credentials_are_rejected(self) -> None:
        weakened = self.source.replace(CHECKOUT, "actions/checkout@v4", 1)
        weakened = weakened.replace("persist-credentials: false", "persist-credentials: true", 1)
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_secret_before_admission_is_rejected(self) -> None:
        marker = "- name: Admit exact current main before private credential"
        weakened = self.source.replace(
            marker, f"# {SECRET}\n      {marker}", 1
        )
        with self.assertRaises(AssertionError):
            validate_policy(weakened)


if __name__ == "__main__":
    unittest.main()
