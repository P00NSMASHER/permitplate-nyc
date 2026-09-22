# PermitPlate private operational state migration

Issue #15 requires operational detection and opportunity state to stop advancing in the public `permitplate-nyc` repository without changing scoring, materiality, history semantics, concurrency, or launch gates.

## Storage contract

Use a dedicated **private GitHub repository** with a `main` branch as the durable state store. The public repository needs only:

- repository variable `PERMITPLATE_STATE_REPO` = `owner/private-state-repo`
- repository secret `PERMITPLATE_STATE_TOKEN` = a fine-grained token with **Contents: Read and write** only for that private state repository

The workflow verifies through the GitHub API that the configured repository is actually private and refuses to run if it is public, missing, or equal to the public application repository.

## One-time migration

The first successful detection run checks whether the private repository contains both:

- `state/detection-ledger.json`
- `state/opportunity-ledger.json`

If both are absent, the workflow walks the public repository's Git history and selects the most recent commit that still contains an intact pair. It copies both files into the private repository, validates their existing ledger fingerprints and initialization markers with the current ledger validators, commits the pair together, and only then allows a normal detection advance.

If one file exists without the other, or the historical pair fails validation, the workflow fails closed. It never bootstraps an empty replacement baseline. That preserves the existing baseline/materiality history and prevents an existing candidate set from being reclassified as `NEW_ENTITY` merely because storage moved.

## Ongoing writes and concurrency

The detection workflow has only `contents: read` permission in the public repository. Operational mutation happens in the private checkout.

All state/readiness runs share one GitHub Actions concurrency group with `cancel-in-progress: false`. A successful operational run stages both ledgers and creates one Git commit before a normal non-force push. If another writer moves the private branch, the push fails instead of overwriting newer state.

The detailed detection receipts, scored packages, and opportunity event keys remain runner-local. Public Actions retain only aggregate counts, gate states, and cryptographic fingerprints.

Launch readiness reads the same private ledgers. The detection workflow re-runs launch readiness after the private state commit, preserving the previous behavior where a public state commit triggered readiness evaluation.

## Public history assessment

This migration does **not** rewrite Git history and must not be described as deleting prior exposure. Historical public commits remain recoverable, including the state advances already identified in issue #15 (for example `037bf260`, `82650f3d`, `eed210af`, `176dca90`, and `1da24622`). External parties can still inspect those historical snapshots and diffs.

The remediation stops new operational state from being added to public `main`; it does not erase what was already published.

## Cutover sequence

1. Create a dedicated private state repository with an initialized `main` branch.
2. Add `PERMITPLATE_STATE_REPO` and `PERMITPLATE_STATE_TOKEN` to the public repository settings.
3. Merge the remediation PR.
4. Run **PermitPlate detection ledger** once (or allow the scheduled run). Confirm the private seed commit and the subsequent operational commit if state changed.
5. Confirm the public workflow artifact contains only `public-verification.json` aggregate evidence.
6. Confirm **PermitPlate launch readiness** reads the private ledgers and preserves its existing internal launch gates.

Until steps 1-2 are configured, the workflows fail closed and no new public operational state is written.
