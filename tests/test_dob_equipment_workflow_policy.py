"""Prevent accidental publication or scoring promotion in DOB research workflow."""
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
FLOW=ROOT/".github/workflows/dob-equipment-evidence.yml"
RESEARCH=ROOT/"pipeline/dob-equipment-evidence.js"
RUNNER=ROOT/"pipeline/run-dob-equipment-evidence.js"

def verify(flow,source,runner):
    assert "permissions:\n  contents: read" in flow
    assert "contents: write" not in flow
    assert "workflow_dispatch:" in flow
    assert "pull_request:" in flow
    assert "if: ${{ github.event_name == 'pull_request' }}" in flow
    assert "if: ${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch') }}" in flow
    assert flow.index("Verify exact current main before loading private token") < flow.index("secrets.PERMITPLATE_STATE_TOKEN")
    assert flow.index("Recheck exact protected main immediately before private commit") < flow.index("Publish to private repository with compare-and-swap")
    assert flow.count("git ls-remote --exit-code origin refs/heads/main") == 3
    assert flow.count("persist-credentials: false") == 4
    assert flow.count("actions/checkout@11d5960a326750d5838078e36cf38b85af677262") == 4
    assert "test \"$STATE_REPO\" != \"$GITHUB_REPOSITORY\"" in flow
    assert "gh api \"repos/$STATE_REPO\" --jq '.visibility'" in flow
    assert "research/dob-equipment/$GITHUB_RUN_ID" in flow
    assert 'git -C "$PRIVATE_DIR" push origin HEAD:main' in flow
    assert "node --test pipeline/dob-equipment-evidence.test.js" in flow
    assert "node pipeline/run-dob-equipment-evidence.js" in flow
    assert "upload-artifact" not in flow
    assert "send_email" not in flow
    assert "stripe" not in source.lower() or "never" in source.lower()
    assert "customerDeliveryAllowed:true" not in source
    assert "productionAuthorized:true" not in source
    assert "scoreCandidateWithPolicy" not in source
    assert "process.env.SOCRATA_APP_TOKEN" in runner
    assert "90" in source or "90" in runner
    assert "ownerBusinessName" not in source
    assert "ownerBusinessName" not in runner
    assert "PRIVATE_DOB_EVIDENCE_BOUNDARY_FAILED" in flow

class Policy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f=FLOW.read_text()
        cls.s=RESEARCH.read_text()
        cls.r=RUNNER.read_text()

    def test_policy(self):
        verify(self.f,self.s,self.r)

    def test_reject_token_before_main_verification(self):
        with self.assertRaises((AssertionError, ValueError)):
            verify(self.f.replace("Verify exact current main before loading private token",
                "No exact main admission",1),self.s,self.r)

    def test_no_public_artifact(self):
        with self.assertRaises(AssertionError):
            verify(self.f+"\n- uses: actions/upload-artifact@v4",self.s,self.r)

    def test_never_treat_prepermit_as_operator_identity(self):
        assert "operatorIdentityProven:false" in self.s
        assert "purchaseProven:false" in self.s
        assert "installationCompletedProven:false" in self.s

if __name__=="__main__":
    unittest.main()
