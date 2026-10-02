# Floot x402 rehost rollback procedure

Prepared for project `b69a3ee6-eb01-430d-aa51-da2fc7beeac4`.

## Goal

The existing two-route PA seller is healthy. The eight-route recovery must not make recovery from a bad publish depend on memory, mutable GitHub `main`, or undocumented Floot UI history.

Before the first recovery write, capture the current state of every deployment target that already exists.

## Pre-write snapshot

A public static baseline is captured ahead of the reset at:

`verification/floot-static-rollback-public-latest.json`

It contains the exact response bodies and SHA-256 hashes for the 12 static discovery files that will be overwritten. **Do not assume public bytes equal Floot source bytes without checking.**

After the post-reset `list_files` call:

1. Record the current Floot project version.
2. Compare the 26 deployment targets against the live file tree.
3. Separate targets into:
   - existing files that will be overwritten;
   - new files that do not yet exist.
4. Use batched `read_files` calls (maximum 20 paths each) to read every existing overwrite target with diagnostics off. The current expected set fits in one batch together with the four preserved PA files.
5. For each of the 12 static targets, compare the Floot source content SHA-256 against `verification/floot-static-rollback-public-latest.json`. If a hash differs, trust the freshly read Floot source and record the mismatch; do not silently overwrite the rollback source with the public copy.
6. Save a rollback receipt in GitHub under:
   `verification/floot-pre-rehost-rollback-<projectVersion>.json`

The receipt must contain:

- project id
- production origin
- pre-write Floot version
- timestamp
- existing target path
- exact UTF-8 content for each existing target
- SHA-256 of each captured content
- list of targets that were absent before recovery

Do not include secrets. The recovery routes use public data and the target files should contain no secrets.

## Staging checkpoint

After all 26 writes pass Floot typecheck and tests, create one named Floot checkpoint:

**x402 eight-route rehost staged**

Description should include:

- pinned GitHub source commit
- pre-write Floot version
- 8 paid resources
- 3 fixed reviewer fixtures
- zero AppDeploy runtime dependencies

This checkpoint records the completed staged state; it is useful for auditing, but it is not a substitute for the pre-write rollback receipt.

## Publish failure containment

If `publish_app` itself fails:

- do not retry blindly;
- inspect the publish result/logs;
- leave the staged project intact while diagnosing;
- the previously published production deployment remains the reference until a successful publish replaces it.

## Post-publish verification failure

If publish succeeds but the public buyer checks fail:

1. Classify the failure.
2. If only one newly added route is defective and the two original PA routes remain healthy, do not self-fund a payment to debug it.
3. If discovery advertises unusable routes, treat that as release-critical.
4. Restore the pre-write contents for every overwritten existing target from the rollback receipt.
5. Delete only recovery files that were absent in the pre-write snapshot.
6. Use Floot `expected_version` on every restore mutation and serialize writes/deletes.
7. Run typecheck/tests.
8. Publish the restored baseline once.
9. Verify:
   - `/_api/pa-entity-one`
   - `/_api/pa-business`
   - `/.well-known/x402`
   are back to the known two-route healthy state.

Do not call recovery successful until the public verifier confirms the restored state.

## Production-success rule

Do not discard the rollback receipt immediately after publish. Keep it as historical evidence until:

- all 8 paid routes pass buyer-style zero-spend verification;
- all 3 fixed vendor fixtures pass;
- canonical discovery reports 8 resources;
- Agent402 recognizes the expanded Floot origin.

## Revenue rule

Rollback checks, probes, directory refreshes, and operator activity are not buyer revenue.
