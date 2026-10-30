# Floot Recovery Rollback Procedure

## Why the rollback source must be captured from Floot

Do **not** use `docs/pa-entity-floot-release/*` as an automatic rollback source.

Some checked-in release fixtures already contain staged recovery/vendor-gate discovery state, while the currently published Floot seller still exposes only two paid resources. A rollback must restore the exact pre-migration Floot project contents, not an inferred historical package.

## Public static baseline already captured

A pre-rehost public baseline exists at:

`verification/floot-static-rollback-public-latest.json`

It contains the exact public response bodies and SHA-256 hashes for the 12 static discovery files while the canonical production manifest still exposed 2 paid resources.

This is a cross-check, **not** the authoritative rollback source. Public bytes can differ from Floot source bytes, so the post-reset Floot snapshot below still remains mandatory.

## Mandatory pre-write snapshot

Immediately after the post-reset `list_files`, first compare the 26 deployment targets against the current Floot file tree so new-vs-existing targets are known.

Use `recovery/floot-snapshot-capture-plan.json` as the canonical machine-readable definition of the five normal `read_files` batches, and validate it with `node scripts/validate-floot-snapshot-capture-plan.mjs` before capture.

Then capture these 16 current project files with **deterministic bounded `read_files` batches**. Do not put all 16 files in one call: Floot caps aggregate output and can omit whole files at the end of an oversized batch.

Use this capture order:

**Batch 1 — four proven PA endpoint/schema files**
- `endpoints/pa-business_GET.ts`
- `endpoints/pa-business_GET.schema.ts`
- `endpoints/pa-entity-one_GET.ts`
- `endpoints/pa-entity-one_GET.schema.ts`

**Batch 2 — large discovery files**
- `static/openapi.json`
- `static/.well-known/x402`

**Batch 3 — x402 aliases/catalog**
- `static/.well-known/x402.json`
- `static/.well-known/x402-services.json`
- `static/.well-known/x402-catalog.json`

**Batch 4 — text discovery**
- `static/llms.txt`
- `static/llms-full.txt`
- `static/skill.txt`
- `static/.well-known/x402-service.json`

**Batch 5 — small public metadata**
- `static/.well-known/security.txt`
- `static/sitemap.xml`
- `static/robots.txt`

### Unexpected preexisting recovery targets

After the five mandatory batches, inspect the classification from the fresh `list_files` tree.

If any of the 14 recovery endpoint/schema targets that are normally absent already exist in the Floot project, capture **each of those preexisting files too** before any write. Use additional bounded `read_files` batches; for safety, a single unexpectedly large endpoint may be read by itself.

The snapshot builder deliberately refuses to proceed when a deployment target is classified as preexisting but its exact source content was not captured.

Normal expected snapshot cost: **5 read batches**.

Absolute conservative worst case: **19 read batches** (the 5 normal groups plus one read for each of 14 unexpectedly preexisting recovery endpoint/schema files). Even that worst case keeps the full forward migration comfortably below the 100-action daily allowance.

If any batch response says files were omitted because of the aggregate output cap, immediately read the omitted file(s) in an additional batch before any Floot write.

### Exact-content handling

Floot read tools may present source in a line-numbered (`cat -n`-style) display. The rollback artifact must contain the **file contents only**, never presentation line numbers or headers.

- Prefer any raw/structured content field returned by the Floot tool.
- If only line-numbered presentation is available, reconstruct the content deterministically by removing only the tool-added line-number prefix while preserving every source character, blank line, and line ending that can be represented.
- For the 12 static files, compute the reconstructed SHA-256 and compare it with `verification/floot-static-rollback-public-latest.json`.
- If exact content cannot be reconstructed confidently, or a static hash mismatch cannot be explained by a known source-vs-public transformation, **abort before the first Floot write** and capture the file through a safer read path.
- Do not substitute checked-in recovery fixtures for unreadable current Floot source.

Normalize the raw capture with:

`node scripts/build-floot-pre-rehost-snapshot.mjs <raw-capture.json> verification/floot-pre-rehost-rollback-<projectVersion>.json`

The raw capture JSON must contain:
- `projectId`
- `projectVersion` from the fresh Floot `list_files`
- `productionOrigin`
- `projectPaths` from the current Floot file tree
- every file returned by the bounded capture batches as `{ path, exists, content }`

The builder automatically:
- derives which of the 26 recovery targets already exist,
- classifies the remaining recovery targets as absent,
- computes UTF-8 byte lengths,
- computes SHA-256 hashes,
- embeds the pinned recovery branch/commit from the deployment queue.

Persist the normalized result in one GitHub JSON artifact before the first Floot write:

`verification/floot-pre-rehost-rollback-<projectVersion>.json`

If that versioned artifact already exists from an interrupted attempt, do not overwrite it blindly. Compare project version, pinned source commit, every captured path/hash, and the preexisting/absent recovery-target sets. Reuse the existing artifact only when those rollback facts match exactly; otherwise abort before any Floot write and re-establish the current project state.

The snapshot must include:

- Floot project id
- Floot project version returned by `list_files`
- production origin
- capture time
- all 16 paths
- exact UTF-8 contents
- whether each file existed
- UTF-8 byte length
- a SHA-256 digest for each content string
- `preexistingRecoveryTargets`: every deploy-map target that existed before recovery
- `absentRecoveryTargets`: every deploy-map target that did not exist before recovery

For each of the 12 static files, compare the freshly read Floot-source SHA-256 to the matching public baseline entry. If the hashes differ, record the mismatch and **trust the freshly read Floot source** as rollback authority.

Validate the snapshot with:

`node scripts/validate-floot-pre-rehost-snapshot.mjs <snapshot.json>`

Before building the snapshot receipt, verify that **all 16 expected paths were returned in full** across the capture batches. Do not infer omitted content from public bytes or checked-in fixtures.

Do not begin recovery writes until the snapshot commit succeeds and the snapshot validator passes.

After the normalized snapshot is committed, precompute the reverse action set with:

`node scripts/build-floot-rollback-plan.mjs verification/floot-pre-rehost-rollback-<projectVersion>.json verification/floot-rollback-plan-<projectVersion>.json`

Commit that rollback-plan JSON before the first Floot write. It classifies each of the 26 recovery targets as either:
- restore the captured preexisting content, or
- delete the target because it was absent before recovery.

The four proven PA files are verification-only in the rollback plan because the forward deployment does not overwrite them.

## Staging checkpoint before publish

After all 26 recovery writes are complete and both Floot typecheck and project tests pass, create one named Floot checkpoint:

**x402 eight-route rehost staged**

Include in the checkpoint description:

- pinned GitHub source commit
- pre-write Floot project version
- 8 paid resources
- 3 fixed reviewer fixtures
- zero AppDeploy runtime dependencies

The checkpoint is an audit/recovery aid. It does not replace the durable pre-write GitHub snapshot.

## Normal failure before publish

If any write, typecheck, or project test fails:

1. **Do not publish.**
2. The current published production app remains the previous known-good version.
3. Fix the staged project defect while preserving the captured baseline.
4. Do not spend actions restoring static files merely because the unpublished dev state is broken unless a later retry requires a clean project state.

## Failure after publish

If the new publish completes but public buyer checks fail:

1. Stop marketplace/Agent402 updates.
2. Use the snapshot as the exact source for all previously existing overwritten files.
3. Delete only the new recovery endpoint/schema files that did not exist before migration:
   - `endpoints/vendor-intake-gate_GET.ts`
   - `endpoints/vendor-intake-gate_GET.schema.ts`
   - `endpoints/vendor-intake-demo_GET.ts`
   - `endpoints/vendor-intake-demo_GET.schema.ts`
   - `endpoints/sec-filings_GET.ts`
   - `endpoints/sec-filings_GET.schema.ts`
   - `endpoints/us-address-geocode_GET.ts`
   - `endpoints/us-address-geocode_GET.schema.ts`
   - `endpoints/ofac-sdn-screen_GET.ts`
   - `endpoints/ofac-sdn-screen_GET.schema.ts`
   - `endpoints/domain-rdap_GET.ts`
   - `endpoints/domain-rdap_GET.schema.ts`
   - `endpoints/treasury-average-rates_GET.ts`
   - `endpoints/treasury-average-rates_GET.schema.ts`
4. Restore the 12 static files from the snapshot using serialized writes and current `expected_version`.
5. Re-run typecheck/tests.
6. Republish once.
7. Re-run the current two-route production verifier.
8. Do not resume recovery until the original two-route seller is confirmed healthy again.

## Existing PA endpoints

The four PA files are preserved during the planned migration and normally require no rollback write. Their captured copies exist only to detect unexpected mutation and as a last-resort restore source.

## Floot history

Floot records each write in project history, and `read_file` / `read_files` can walk older file versions using `older_than`. That history is a secondary recovery path.

The GitHub pre-write snapshot is the primary rollback source because it is durable outside the Floot project and remains available after chat/session interruption.

## Forward capture action budget

The pre-write snapshot normally uses 5 `read_files` actions after `list_files`. Additional bounded reads are mandatory for any omitted file or unexpectedly preexisting recovery endpoint/schema target. The absolute conservative bound is 19 snapshot-read actions, and the full forward deployment still remains comfortably below the 100-action allowance.

## Rollback action budget

Worst-case post-publish rollback:

- delete 14 newly added endpoint/schema files
- restore 12 static files
- typecheck
- tests
- publish
- publish-status check
- public verification
- one staging checkpoint in the normal forward path

This is still within a fresh 100-action Floot daily window if needed, but rollback should be treated as exceptional. The pre-publish typecheck/tests and exact-head CI gates are intended to prevent reaching this path.
