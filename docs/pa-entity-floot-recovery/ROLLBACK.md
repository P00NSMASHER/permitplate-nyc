# Floot Recovery Rollback Procedure

## Why the rollback source must be captured from Floot

Do **not** use `docs/pa-entity-floot-release/*` as an automatic rollback source.

Some checked-in release fixtures already contain staged recovery/vendor-gate discovery state, while the currently published Floot seller still exposes only two paid resources. A rollback must restore the exact pre-migration Floot project contents, not an inferred historical package.

## Mandatory pre-write snapshot

Immediately after the post-reset `list_files`, use **one** `read_files` call to capture these 16 current project files:

### Four proven PA files

- `endpoints/pa-business_GET.ts`
- `endpoints/pa-business_GET.schema.ts`
- `endpoints/pa-entity-one_GET.ts`
- `endpoints/pa-entity-one_GET.schema.ts`

### Twelve static files that the recovery overwrites

- `static/openapi.json`
- `static/llms.txt`
- `static/llms-full.txt`
- `static/skill.txt`
- `static/.well-known/x402`
- `static/.well-known/x402.json`
- `static/.well-known/x402-services.json`
- `static/.well-known/x402-service.json`
- `static/.well-known/x402-catalog.json`
- `static/.well-known/security.txt`
- `static/sitemap.xml`
- `static/robots.txt`

Persist those exact contents in one GitHub JSON artifact before the first Floot write:

`verification/floot-pre-rehost-snapshot-<timestamp>.json`

The snapshot must include:

- Floot project id
- Floot project version returned by `list_files`
- production origin
- capture time
- all 16 paths
- exact UTF-8 contents
- whether each file existed
- source length
- a SHA-256 digest for each content string

Do not begin recovery writes until the snapshot commit succeeds.

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

## Rollback action budget

Worst-case post-publish rollback:

- delete 14 newly added endpoint/schema files
- restore 12 static files
- typecheck
- tests
- publish
- publish-status check
- public verification

This is still within a fresh 100-action Floot daily window if needed, but rollback should be treated as exceptional. The pre-publish typecheck/tests and exact-head CI gates are intended to prevent reaching this path.
