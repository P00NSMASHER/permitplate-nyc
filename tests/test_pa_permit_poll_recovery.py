"""No customer data or live provider calls: exact identity and retry-budget QA."""
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "pipeline/pa-permit-poll-recovery.py"
spec = importlib.util.spec_from_file_location("pa_permit_poll_recovery", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
REPO = mod.REPO
SHA = "a" * 40
NOW = dt.datetime(2026, 11, 8, 18, 5, tzinfo=dt.timezone.utc)

def run(i, name, when, status="completed", conclusion="success",
        event="schedule", branch="main", repo=REPO):
    return {"id": i, "name": name, "status": status, "conclusion": conclusion,
            "created_at": when, "head_branch": branch,
            "head_repository": {"full_name": repo}, "event": event}

def event(name="push", trigger_id=None):
    t = {"repository": {"full_name": REPO}, "ref": "refs/heads/main", "after": SHA}
    if name == "workflow_run":
        t["workflow_run"] = run(
            trigger_id or 7, mod.WATCHDOG_NAME, "2026-11-08T17:03:00Z",
            conclusion="failure")
    return t

def history(runs):
    return {"workflow_runs": runs}

W = run(7, mod.WATCHDOG_NAME, "2026-11-08T17:03:00Z", conclusion="failure")
PA_OLD = run(11, mod.INTAKE_NAME, "2026-11-08T07:53:00Z")

def job_reader(_):
    return {"jobs": [{"name": "policy", "conclusion": "success", "status": "completed"},
                     {"name": "intake", "conclusion": "success", "status": "completed"}]}

def check(w=None, polls=None, *, kind="push", jobs=job_reader, trigger=None):
    return mod.decide(kind, trigger or event(kind), SHA,
                      history(w if w is not None else [W]),
                      history(polls if polls is not None else [PA_OLD]),
                      NOW, jobs)

class PaPollRecoveryTests(unittest.TestCase):
    def test_missing_scheduled_poll_is_recovered_without_customer_actions(self):
        self.assertEqual(check(), "RECOVER_MISSED_PROVIDER_POLL")
        self.assertEqual(check(kind="workflow_run"), "RECOVER_MISSED_PROVIDER_POLL")

    def test_actual_recent_intake_prevents_unnecessary_dispatch(self):
        fresh = run(12, mod.INTAKE_NAME, "2026-11-08T15:35:00Z")
        self.assertEqual(check(polls=[fresh, PA_OLD]),
                         "VERIFIED_PROVIDER_POLL_WITHIN_NINE_HOURS")
        # Green policy-only workflow must NOT be counted as actual Stripe readback.
        self.assertEqual(check(polls=[fresh, PA_OLD],
                               jobs=lambda _: {"jobs": [
                                   {"name": "policy", "status": "completed",
                                    "conclusion": "success"},
                                   {"name": "intake", "status": "completed",
                                    "conclusion": "skipped"}]}),
                         "RECOVER_MISSED_PROVIDER_POLL")

    def test_pending_poll_or_recent_recovery_is_not_duplicated(self):
        pending = run(13, mod.INTAKE_NAME, "2026-11-08T17:55:00Z",
                      "in_progress", None)
        self.assertEqual(check(polls=[pending, PA_OLD]),
                         "PROVIDER_POLL_ALREADY_RUNNING")
        dispatched = run(14, mod.INTAKE_NAME, "2026-11-08T17:20:00Z",
                         event="workflow_dispatch", conclusion="failure")
        self.assertEqual(check(polls=[dispatched, PA_OLD]),
                         "RECENT_RECOVERY_COOLDOWN")

    def test_attempt_cap_is_measured_per_utc_day(self):
        attempts = [run(30+i, mod.INTAKE_NAME,
                        f"2026-11-08T{11+i:02}:00:00Z",
                        conclusion="failure", event="workflow_dispatch") for i in range(4)]
        self.assertEqual(check(polls=attempts+[PA_OLD]),
                         "DAILY_RETRY_BUDGET_EXHAUSTED")

    def test_bad_trigger_or_later_watchdog_success_cannot_recover(self):
        self.assertEqual(check(w=[run(8, mod.WATCHDOG_NAME, "2026-11-08T17:35:00Z"),
                                  W]), "WATCHDOG_CURRENT_OR_UNCONFIRMED")
        self.assertEqual(check(kind="workflow_run", trigger=event(
            "workflow_run", trigger_id=99)),
            "NEWER_WATCHDOG_SUPERSEDED_TRIGGER")
        for wrong in ({**event(), "ref": "refs/heads/feature"},
                      {**event(), "repository": {"full_name": "other/repo"}},
                      {**event(), "after": "b"*40}):
            with self.assertRaises(mod.RecoveryHold):
                check(trigger=wrong)
        with self.assertRaises(mod.RecoveryHold):
            check(kind="workflow_run", trigger={"repository": {"full_name": REPO},
                 "workflow_run": run(5, mod.WATCHDOG_NAME,
                                     "2026-11-08T17:03:00Z",
                                     conclusion="success")})
        self.assertEqual(check(w=[run(1, mod.WATCHDOG_NAME,
                                     "2026-11-08T13:00:00Z", conclusion="failure")]),
                         "WATCHDOG_FAILURE_NOT_CURRENT")

    def test_provider_api_or_history_malformed_never_fails_open(self):
        fresh = run(12, mod.INTAKE_NAME, "2026-11-08T15:35:00Z")
        with self.assertRaises(mod.RecoveryHold):
            check(polls=[fresh], jobs=lambda _: {})
        with self.assertRaises(mod.RecoveryHold):
            mod.decide("push", event(), SHA, {}, history([PA_OLD]), NOW, job_reader)
        with self.assertRaises(mod.RecoveryHold):
            check(polls=[{**PA_OLD, "id": "not-an-integer"}])
        with self.assertRaises(mod.RecoveryHold):
            check(polls=[{**PA_OLD, "created_at": "bad"}])

if __name__ == "__main__":
    unittest.main()
