"""Adversarial policy for the PA Entity directory-status writer."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github" / "workflows" / "pa-entity-directory-status.yml"

CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
LIVE_IF = (
    "if: ${{ github.ref == 'refs/heads/main' && "
    "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}"
)
LEASE = 'test "$GITHUB_SHA" = "$remote_main"'


def validate_policy(source: str) -> None:
    """Reject persisted write credentials or writes from stale/selected source."""
    assert "  pull_request:\n" in source
    assert "permissions: {}\n" in source
    assert "  policy:\n" in source
    assert "    needs: policy\n" in source
    assert LIVE_IF in source
    assert source.count(CHECKOUT) == 2
    assert source.count("persist-credentials: false") == 2
    assert "actions/checkout@v4" not in source

    policy = source[source.index("  policy:\n"):source.index("  check:\n")]
    assert "permissions:\n      contents: read" in policy
    assert "test_pa_entity_directory_status_workflow_policy.py" in policy
    assert "GH_TOKEN" not in policy

    writer = source[source.index("  check:\n"):]
    assert "permissions:\n      contents: write" in writer
    assert source.count("GH_TOKEN: ${{ github.token }}") == 1
    assert "credential.helper='!f()" in source
    assert source.count(LEASE) >= 2
    assert 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in source
    assert "git reset --hard origin/main" not in source
    assert "git push origin HEAD:main" not in source

    admission = source.index("- name: Admit exact current main before external collection")
    collection = source.index("- name: Capture zero-spend directory snapshot")
    commit = source.index("- name: Commit refreshed receipt")
    push = source.rindex("push origin HEAD:refs/heads/main")
    assert admission < collection < commit < push


class DirectoryStatusWorkflowPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = FLOW.read_text(encoding="utf-8")

    def test_current_writer_is_exact_main_and_credential_scoped(self) -> None:
        validate_policy(self.source)

    def test_mutable_checkout_or_persisted_credentials_are_rejected(self) -> None:
        weakened = self.source.replace(CHECKOUT, "actions/checkout@v4", 1)
        weakened = weakened.replace("persist-credentials: false", "persist-credentials: true", 1)
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_stale_main_lease_is_rejected(self) -> None:
        weakened = self.source.replace(LEASE, 'test -n "$remote_main"')
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_resetting_onto_unknown_newer_main_is_rejected(self) -> None:
        marker = "git config user.name 'github-actions[bot]'"
        weakened = self.source.replace(marker, "git reset --hard origin/main\n          " + marker, 1)
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_branch_selected_writer_is_rejected(self) -> None:
        weakened = self.source.replace(LIVE_IF, "if: ${{ github.event_name != 'pull_request' }}")
        with self.assertRaises(AssertionError):
            validate_policy(weakened)


if __name__ == "__main__":
    unittest.main()
