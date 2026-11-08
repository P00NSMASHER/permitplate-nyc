#!/usr/bin/env python3
"""Bounded, source-bound scheduling recovery for existing READ-ONLY PA intake.

This module never reads Stripe, loads private customer data, or writes provider
state. GitHub Actions is the sole authorized workflow dispatcher.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess

REPO = "P00NSMASHER/permitplate-nyc"
WATCHDOG_NAME = "PermitPlate PA independent order watchdog"
INTAKE_NAME = "PermitPlate PA private order intake"
PROVIDER_AGE = dt.timedelta(hours=9)
FAILURE_AGE = dt.timedelta(minutes=90)
COOLDOWN = dt.timedelta(minutes=90)
DAILY_DISPATCH_CAP = 4
ACTIVE = {"queued", "requested", "pending", "waiting", "in_progress"}
EVENTS = {"schedule", "push", "workflow_dispatch"}

class RecoveryHold(ValueError):
    pass

def stamp(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise RecoveryHold("Invalid GitHub timestamp")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RecoveryHold("Invalid GitHub timestamp") from exc
    return parsed.astimezone(dt.timezone.utc)

def require_history(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("workflow_runs"), list):
        raise RecoveryHold("Missing exact GitHub workflow history")
    if len(doc["workflow_runs"]) > 100:
        raise RecoveryHold("Unbounded workflow history")
    for run in doc["workflow_runs"]:
        if not isinstance(run, dict) or type(run.get("id")) is not int or run["id"] <= 0:
            raise RecoveryHold("Invalid GitHub workflow run identity")
        if run.get("status") not in ACTIVE | {"completed"}:
            raise RecoveryHold("Unknown GitHub run status")
        stamp(run.get("created_at"))
    return doc["workflow_runs"]

def trusted_run(run, name):
    return (run.get("name") == name
            and run.get("head_branch") == "main"
            and (run.get("head_repository") or {}).get("full_name") == REPO
            and run.get("event") in EVENTS)

def admit_event(event, trigger, source_sha):
    if not isinstance(trigger, dict) or trigger.get("repository", {}).get("full_name") != REPO:
        raise RecoveryHold("Wrong trigger repository")
    if event == "push":
        if trigger.get("ref") != "refs/heads/main" or trigger.get("after") != source_sha:
            raise RecoveryHold("Not a protected main push")
    elif event == "workflow_run":
        run = trigger.get("workflow_run") or {}
        if not (trusted_run(run, WATCHDOG_NAME)
                and run.get("status") == "completed"
                and run.get("conclusion") == "failure"):
            raise RecoveryHold("Not a failed first-party PA watchdog")
    else:
        raise RecoveryHold("Untrusted recovery event")

def decide(event, trigger, source_sha, watch_doc, intake_doc, now, job_reader):
    admit_event(event, trigger, source_sha)
    watchdogs = require_history(watch_doc)
    intakes = require_history(intake_doc)
    valid_w = [r for r in watchdogs if trusted_run(r, WATCHDOG_NAME)]
    if not valid_w:
        return "WATCHDOG_PROOF_MISSING"
    valid_w.sort(key=lambda r: stamp(r["created_at"]), reverse=True)
    w = valid_w[0]
    age = now - stamp(w["created_at"])
    if age < dt.timedelta(0) or age > FAILURE_AGE:
        return "WATCHDOG_FAILURE_NOT_CURRENT"
    if w["status"] != "completed" or w.get("conclusion") != "failure":
        return "WATCHDOG_CURRENT_OR_UNCONFIRMED"
    if event == "workflow_run" and w["id"] != trigger["workflow_run"].get("id"):
        return "NEWER_WATCHDOG_SUPERSEDED_TRIGGER"

    eligible = [r for r in intakes if trusted_run(r, INTAKE_NAME)]
    for r in eligible:
        created = stamp(r["created_at"])
        if now < created:
            raise RecoveryHold("Future provider workflow record")
        if r["status"] in ACTIVE:
            return "PROVIDER_POLL_ALREADY_RUNNING"
        if r["event"] == "workflow_dispatch" and now - created < COOLDOWN:
            return "RECENT_RECOVERY_COOLDOWN"
    daily = sum(r["event"] == "workflow_dispatch"
                and stamp(r["created_at"]).date() == now.date()
                for r in eligible)
    if daily >= DAILY_DISPATCH_CAP:
        return "DAILY_RETRY_BUDGET_EXHAUSTED"

    # A green workflow badge can be policy-only: verify the actual authenticated
    # read-only intake job before treating a provider poll as fresh.
    recent_green = [r for r in eligible if r["status"] == "completed"
                    and r.get("conclusion") == "success"
                    and now - stamp(r["created_at"]) <= PROVIDER_AGE]
    for r in recent_green[:8]:
        payload = job_reader(r["id"])
        jobs = payload.get("jobs") if isinstance(payload, dict) else None
        if not isinstance(jobs, list):
            raise RecoveryHold("Cannot attest actual provider intake job")
        proofs = [j for j in jobs if j.get("name") == "intake"
                  and j.get("status") == "completed"
                  and j.get("conclusion") == "success"]
        if len(proofs) == 1:
            return "VERIFIED_PROVIDER_POLL_WITHIN_NINE_HOURS"
        if len(proofs) > 1:
            raise RecoveryHold("Ambiguous provider intake proof")
    return "RECOVER_MISSED_PROVIDER_POLL"

def gh_jobs(run_id):
    result = subprocess.run(
        ["gh", "api", f"repos/{REPO}/actions/runs/{run_id}/jobs?per_page=100"],
        capture_output=True, text=True, check=False, timeout=30,
    )
    if result.returncode:
        raise RecoveryHold("Cannot verify provider job result")
    try:
        return json.loads(result.stdout)
    except ValueError as exc:
        raise RecoveryHold("Malformed provider job result") from exc

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--event", required=True)
    p.add_argument("--sha", required=True)
    p.add_argument("--trigger", required=True, type=Path)
    p.add_argument("--watchdogs", required=True, type=Path)
    p.add_argument("--intakes", required=True, type=Path)
    args = p.parse_args()
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise RecoveryHold("Wrong executing repository")
    if len(args.sha) != 40 or any(c not in "0123456789abcdef" for c in args.sha):
        raise RecoveryHold("Invalid main commit")
    result = decide(
        args.event, json.loads(args.trigger.read_text()),
        args.sha, json.loads(args.watchdogs.read_text()),
        json.loads(args.intakes.read_text()), dt.datetime.now(dt.timezone.utc), gh_jobs,
    )
    print(f"PA_READ_ONLY_INTAKE_RECOVERY:{result}")
    if os.environ.get("GITHUB_OUTPUT"):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as sink:
            sink.write("recover=" + ("true" if result == "RECOVER_MISSED_PROVIDER_POLL" else "false") + "\n")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.TimeoutExpired) as err:
        print("PA_READ_ONLY_INTAKE_RECOVERY:PROVIDER_EVIDENCE_UNAVAILABLE")
        raise SystemExit(2) from None
