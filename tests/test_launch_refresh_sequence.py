"""Exercise the actual pre-credential workflow admission with hostile events."""
import contextlib
import fnmatch
import io
import json
import os
from pathlib import Path
import re
import tempfile
import textwrap
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
LAUNCH = ROOT / ".github/workflows/launch-readiness.yml"
RESEARCH = ROOT / ".github/workflows/curated-research.yml"
SHA = "a" * 40
REPO = "P00NSMASHER/permitplate-nyc"


def event_paths(source, event):
    block = source.split("\n  " + event + ":\n", 1)[1]
    block = re.split(r"\n(?:  [a-z_]+:|[a-z]+:)", block, 1)[0]
    return re.findall(r"^      - '([^']+)'$", block, re.M)


def actual_admission(source):
    step = source.split(
        "      - name: Admit trusted refresh completion before private credential\n", 1
    )[1].split("\n      - name:", 1)[0]
    code = step.split("python3 - <<'PY'\n", 1)[1].split("\n          PY", 1)[0]
    return textwrap.dedent(code)


def good_event():
    return {
        "repository": {"full_name": REPO},
        "workflow_run": {
            "name": "PermitPlate curated research (private)",
            "path": ".github/workflows/curated-research.yml",
            "status": "completed", "conclusion": "success", "event": "push",
            "head_branch": "main", "head_sha": SHA,
            "head_repository": {"full_name": REPO},
        },
    }


class LaunchRefreshSequenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.launch = LAUNCH.read_text()
        cls.research = RESEARCH.read_text()

    def admit(self, event=None, name="workflow_run", ref="refs/heads/main"):
        code = actual_admission(self.launch)
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / "event.json"
            event_path.write_text(json.dumps(good_event() if event is None else event))
            environment = {
                "GITHUB_EVENT_NAME": name, "GITHUB_EVENT_PATH": str(event_path),
                "GITHUB_REF": ref, "GITHUB_SHA": SHA, "GITHUB_REPOSITORY": REPO,
            }
            with patch.dict(os.environ, environment), contextlib.redirect_stdout(io.StringIO()):
                exec(compile(code, "launch-workflow-admission", "exec"), {})

    def test_automatic_readiness_follows_refresh_without_an_independent_timer(self):
        trigger = self.launch.split("\non:\n", 1)[1].split("\npermissions:", 1)[0]
        for expected in ("  workflow_dispatch:", "  workflow_run:",
                         "workflows: ['PermitPlate curated research (private)']",
                         "types: [completed]", "branches: [main]"):
            self.assertIn(expected, trigger)
        self.assertNotIn("\n  push:", trigger)
        self.assertNotIn("\n  schedule:", trigger)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", self.launch)
        self.assertIn("- cron: '12 14 * * *'", self.research)
        self.assertEqual(self.research.count("- cron:"), 1)

    def test_existing_readiness_and_public_build_inputs_trigger_the_writer(self):
        writer_paths = event_paths(self.research, "push")
        policy_paths = event_paths(self.research, "pull_request")
        for dependency in event_paths(self.launch, "pull_request"):
            self.assertIn(dependency, writer_paths, dependency)
            self.assertIn(dependency, policy_paths, dependency)
        builder = (ROOT / "build-site.js").read_text()
        files = re.findall(r"'([^']+)'",
            builder.split("const PUBLIC_FILES=Object.freeze([", 1)[1].split("]);", 1)[0])
        self.assertGreater(len(files), 20)
        for file in files:
            self.assertTrue(any(fnmatch.fnmatchcase(file, p) for p in writer_paths), file)

    def test_admission_precedes_every_private_secret_and_checkout(self):
        boundary = self.launch.index("Admit trusted refresh completion before private credential")
        for after in ("secrets.PERMITPLATE_STATE_TOKEN", "secrets.PERMITPLATE_STRIPE_READ_KEY",
                      "Check out private state repository read-only"):
            self.assertLess(boundary, self.launch.index(after))
        self.assertIn('test "$GITHUB_SHA" = "$remote_main"', self.launch)
        self.assertIn("permissions:\n  contents: read", self.launch)
        self.assertNotIn("contents: write", self.launch)
        self.assertNotIn("git push", self.launch)
        self.assertIn("format('permitplate-private-state-{0}', vars.PERMITPLATE_STATE_REPO)", self.launch)
        self.assertIn("cancel-in-progress:", self.launch)

    def test_current_main_success_from_each_existing_writer_event_is_admitted(self):
        for upstream in ("push", "schedule", "workflow_dispatch"):
            with self.subTest(upstream=upstream):
                event = good_event()
                event["workflow_run"]["event"] = upstream
                self.admit(event)

    def test_manual_launch_remains_read_only_and_main_only(self):
        self.admit({}, name="workflow_dispatch")
        with self.assertRaises(SystemExit):
            self.admit({}, name="workflow_dispatch", ref="refs/heads/proposal")

    def test_wrong_repository_or_fork_is_refused(self):
        for location in ("repository", "head_repository"):
            with self.subTest(location=location):
                event = good_event()
                target = event if location == "repository" else event["workflow_run"]
                target[location]["full_name"] = "untrusted/permitplate-nyc"
                with self.assertRaises(SystemExit):
                    self.admit(event)

    def test_wrong_workflow_branch_or_commit_is_refused(self):
        for field, value in (("name", "Other workflow"), ("path", ".github/workflows/other.yml"),
                             ("head_branch", "proposal"), ("head_sha", "b" * 40)):
            with self.subTest(field=field):
                event = good_event()
                event["workflow_run"][field] = value
                with self.assertRaises(SystemExit):
                    self.admit(event)

    def test_failed_incomplete_or_untrusted_upstream_event_is_refused(self):
        for field, values in {
            "conclusion": ("failure", "cancelled", "skipped", None),
            "status": ("queued", "in_progress", None),
            "event": ("pull_request", "pull_request_target", "workflow_run", None),
        }.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    event = good_event()
                    event["workflow_run"][field] = value
                    with self.assertRaises(SystemExit):
                        self.admit(event)

    def test_missing_event_provenance_is_refused(self):
        for event in ({}, {"workflow_run": {}}, {"repository": {"full_name": REPO}}):
            with self.assertRaises(SystemExit):
                self.admit(event)

    def test_direct_push_schedule_or_pr_cannot_enter_the_read_only_live_job(self):
        for event in ("push", "schedule", "pull_request", "pull_request_target"):
            with self.subTest(event=event), self.assertRaises(SystemExit):
                self.admit({}, name=event)


if __name__ == "__main__":
    unittest.main()
