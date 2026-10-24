"""Security floor for every Node-driven PermitPlate GitHub Actions workflow.

Static policy only: does not run network requests, alter CI schedules, or deploy.
"""
from pathlib import Path
import re
import unittest

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"
NODE_SELECTOR = re.compile(r"(?m)^\\s*node-version:\\s*['\\\"]?([^'\\\"\\s#]+)")
NODE_COMMAND = re.compile(r"(?m)^\\s*(?:-\\s*)?(?:run:\\s*)?(?:node|npm|npx)(?:\\s|$)")
PATCHED_NODE = "22.23.4"


class CIWorkflowNodeSecurity(unittest.TestCase):
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
