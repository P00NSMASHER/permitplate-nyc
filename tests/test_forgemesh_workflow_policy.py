"""Adversarial offline policy for the ForgeMesh preflight workflow."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLOW = ROOT / ".github" / "workflows" / "forgemesh-pa-entity-preflight.yml"

CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
UPLOAD = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
UPSTREAM = "257348bbc78d1e8077957fba1bdb0a57dc4cf97e"
LIVE_IF = (
    "if: ${{ github.ref == 'refs/heads/main' && "
    "(github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}"
)
MAIN_ASSERTION = 'test "$GITHUB_SHA" = "$remote_main"'


def validate_policy(source: str) -> None:
    """Fail closed if branch code or mutable upstreams can publish evidence."""
    assert "  pull_request:\n" in source
    assert "    branches:\n      - main\n" in source
    assert "permissions:\n  contents: read\n" in source
    assert "contents: write" not in source
    assert LIVE_IF in source
    assert MAIN_ASSERTION in source
    assert 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"' in source
    assert "git ls-remote --exit-code origin refs/heads/main" in source

    assert f"FORGEMESH_VALIDATOR_SHA: {UPSTREAM}" in source
    assert 'fetch --depth 1 origin "$FORGEMESH_VALIDATOR_SHA"' in source
    assert 'checkout --detach "$FORGEMESH_VALIDATOR_SHA"' in source
    assert "git clone " not in source
    assert "origin/main" not in source
    assert "git push " not in source
    assert "git reset --hard" not in source
    assert "git commit " not in source

    assert source.count(CHECKOUT) == 2
    assert source.count("persist-credentials: false") == 2
    assert UPLOAD in source
    assert "actions/checkout@v4" not in source
    assert "actions/upload-artifact@v4" not in source
    assert "forgemesh-pa-entity-preflight-${{ github.sha }}" in source
    assert "cancel-in-progress: ${{ github.event_name == 'pull_request' }}" in source


class ForgeMeshWorkflowPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = FLOW.read_text(encoding="utf-8")

    def test_current_workflow_is_read_only_and_source_pinned(self) -> None:
        validate_policy(self.source)

    def test_branch_selectable_live_execution_is_rejected(self) -> None:
        weakened = self.source.replace(
            LIVE_IF, "if: ${{ github.event_name != 'pull_request' }}"
        )
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_repository_writer_cannot_return(self) -> None:
        weakened = self.source.replace(
            "permissions:\n  contents: read",
            "permissions:\n  contents: write",
        ) + "\n# git push origin HEAD:main\n"
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_mutable_upstream_cannot_return(self) -> None:
        weakened = self.source.replace(
            f"FORGEMESH_VALIDATOR_SHA: {UPSTREAM}",
            "FORGEMESH_VALIDATOR_SHA: main",
        )
        with self.assertRaises(AssertionError):
            validate_policy(weakened)

    def test_mutable_action_or_persisted_credentials_is_rejected(self) -> None:
        weakened = self.source.replace(CHECKOUT, "actions/checkout@v4", 1)
        weakened = weakened.replace(
            "persist-credentials: false", "persist-credentials: true", 1
        )
        with self.assertRaises(AssertionError):
            validate_policy(weakened)


if __name__ == "__main__":
    unittest.main()
