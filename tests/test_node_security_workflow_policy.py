"""Security floor for every Node-driven PermitPlate GitHub Actions workflow.

Static policy only: does not run network requests, alter CI schedules, or deploy.
"""
from pathlib import Path
import re
import unittest

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"
NODE_SELECTOR = re.compile(r'''(?m)^[ \t]*node-version:[ \t]*["']?([0-9][^"'\s#]*)''')
NODE_COMMAND = re.compile(r'(?m)^[ \t]*(?:-[ \t]*)?(?:run:[ \t]*)?(?:node|npm|npx)(?:[ \t]|$)')
PATCHED_NODE = "22.23.4"


class CIWorkflowNodeSecurity(unittest.TestCase):
    def test_matcher_detects_legacy_node_versions_and_commands(self):
        self.assertEqual(NODE_SELECTOR.findall("          node-version: '20'"), ["20"])
        self.assertEqual(NODE_SELECTOR.findall('          node-version: "22"'), ["22"])
        self.assertIsNotNone(NODE_COMMAND.search("      - run: node --version"))
        self.assertIsNotNone(NODE_COMMAND.search("          npm ci --no-audit"))

    def test_every_explicit_node_selector_is_security_patched(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            source = path.read_text(encoding="utf-8")
            for version in NODE_SELECTOR.findall(source):
                with self.subTest(workflow=path.name, version=version):
                    self.assertEqual(version, PATCHED_NODE)

    def test_workflows_executing_node_provision_it_explicitly(self):
        for path in sorted(WORKFLOWS.glob("*.yml")):
            source = path.read_text(encoding="utf-8")
            if NODE_COMMAND.search(source):
                with self.subTest(workflow=path.name):
                    self.assertIn("actions/setup-node@", source)


if __name__ == "__main__":
    unittest.main()
