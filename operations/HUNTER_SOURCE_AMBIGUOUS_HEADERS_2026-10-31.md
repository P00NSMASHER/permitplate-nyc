# Revenue Product Source Hunter: Ambiguous sheet header fail-closed patch

**Date:** 2026-10-31 (EDT). **Repository:** `P00NSMASHER/permitplate-nyc`. **Scope:** read-only delivery snapshot and source observation validation, no deployment or paid work.

## Reproduced failure and repair

`operations/delivery-verifier.js` previously created sheet row objects with `Object.fromEntries(header.map(...))`. Duplicate normalized column names overwrite earlier data silently: `[['Commercial Fit','HIGH'],['Commercial Fit','LOW']]` becomes `{'Commercial Fit':'LOW'}`. Two contradictory columns can therefore appear to be a single trustworthy cell in a staged graph, delivery receipt or source event, even with live/staging byte equality. This is a demonstrable parser ambiguity, **not evidence of an actual corrupted NYC record or customer report**.

Fix: fail closed on blank headers, duplicates after trimming and case-folding, or a missing header array. Preserve `validateSnapshot()`'s structured `{passed,failures}` contract by catching per-sheet exceptions; `validateSourceObservationReceipts()` now returns a failed, enforced receipt instead of silently accepting an invalid header or throwing a generic exception. The underlying `rowObjects()` helper refuses to create ambiguous objects. Valid sheet rows are unchanged.

Synthetic adversarial cases: graph/queue/source-event/delivery-state duplicate headers, a blank header, case-folded duplicates, receipt duplicates. Positive controls preserve valid arrays and an otherwise valid cross-sheet delivery snapshot. No data values, payment settings or customer-facing UI changed.

## Source candidate scan (immutable revisions, no code imported)

1. [csv-parse / Adaltas](https://github.com/adaltas/node-csv/tree/9fabcbe70ac6d3561db8c11fef3a567f7917cdc2), `csv-parse` 7.0.3; [MIT LICENSE](https://github.com/adaltas/node-csv/blob/9fabcbe70ac6d3561db8c11fef3a567f7917cdc2/LICENSE), pushed 2026-10-22; no declared production dependencies in inspected `packages/csv-parse/package.json`. Supports grouping duplicate columns when parsing **raw CSV text**, but integration would introduce a parser beyond already-parsed sheet arrays.
2. [Papa Parse / Matthew Holt](https://github.com/mholt/PapaParse/tree/1fcb83c64acf61ae636b556b0eadeebaca0aea33), version 5.7.0; [MIT LICENSE](https://github.com/mholt/PapaParse/blob/1fcb83c64acf61ae636b556b0eadeebaca0aea33/LICENSE), pushed 2026-10-27; no runtime dependencies in inspected `package.json`. Browser-oriented streaming CSV features exceed this narrow invariant.

**Decision:** a small independent input-contract guard rather than a dependency. Zero external code copied or dependencies/lockfiles changed. Maintainer activity and primary license files were checked at the above revisions. Absence of past advisories is **not** asserted; no new dependency attack surface was introduced. No NOTICE obligations were created.

## Reproduction and verification

Before: JavaScript `Object.fromEntries([['Commercial Fit','HIGH'],['Commercial Fit','LOW']])` produces the last value with no warning. After: duplicate columns return `passed:false` with `AMBIGUOUS_SHEET_HEADERS` on the fixture, while valid snapshots remain allowed. Tests: `node operations/delivery-verifier.test.js`; then existing protected GitHub required CI and any downstream contract checks. Exact PR head, CI results and review remain authoritative.

**Owner coordination:** no open PermitPlate PRs at branch creation; customer conversion PR #159 was merged to main. [Issue #154](https://github.com/P00NSMASHER/permitplate-nyc/issues/154) proves external Cloudflare integration may deploy from operations-only merges. **Do not merge this PR or trigger deployments** until that release path is verified and explicitly permitted. Rollback: close the isolated PR without changing main.

**Estimated avoided effort:** 1–3 engineer-hours per future opaque duplicate-header incident, assuming someone otherwise must trace cross-sheet provenance; **not measured** and can be zero if no incident occurs. **Revenue impact:** none verified.

**Hunter B coordination:** canonical RETALLY/FreightRecovery/RecoveryOS implementation found in [private value-hunt ledger](https://github.com/P00NSMASHER/github-value-hunt-ledger/tree/main/recoveryworks), not a separately accessible `retally` or `recoveryos` repo under the installed owner repository listing. Ledger main actively received freight proof changes (#902) during this run; no competing write made. Next: inspect existing leases/CI and support a non-overlapping source-linked identity or idempotency regression before making a RecoveryOS branch.
