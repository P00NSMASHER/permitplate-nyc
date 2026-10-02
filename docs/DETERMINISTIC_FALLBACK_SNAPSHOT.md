# PermitPlate Deterministic Fallback Snapshot

## Recovered source
Recovered from the existing PermitPlate launch/quality handoff artifact and extracted as a single Apps Script bundle.

- Extracted source size: 118,151 bytes
- SHA-256: `8935F355A51AC3F438ABEED4F35D0EFACCC801D4771BEAD35DE848B336004843`
- JavaScript syntax: PASS under `node --check`
- Handoff-reported self-tests: 29/29 merged self-tests and 28/28 original regression tests

The recovered bundle includes deterministic implementations for the original DOHMH-oriented path, including:
- source freshness and schema checks;
- never-inspected applicant retrieval;
- recent pre-permit retrieval;
- deterministic lead keys based on CAMIS/stage date;
- source-row deduplication;
- digest generation;
- subscriber/delivery state;
- launch gates and self-tests.

## Critical limitation
This fallback bundle is NOT the same execution path as the later multi-source production Venue Graph described by current product evidence.

The later production intelligence path adds DOHMH + NY SLA + NYC DOB, venue identity, source-event lineage, commercial-fit suppression, category-specific scores, stage progression, corroboration/confidence, and Watch Next logic. That path has been orchestrated primarily through a large natural-language automation rather than this fallback bundle.

Therefore:
- this snapshot is a useful deterministic baseline and source of tested primitives;
- it MUST NOT be represented as the current production engine;
- ProjectSignal/multi-source expansion stays blocked until current production matching/scoring/state logic is extracted into versioned code and replay-tested.

## Immediate migration target
Preserve the deterministic source-health, canonicalization, dedupe, queue and delivery primitives from this fallback, then implement the current production graph behind explicit source adapters and identity/corroboration rules.

Known regression that must be encoded before promotion:
- shared address/co-location alone never establishes entity identity;
- cross-CAMIS or contradictory stable identifiers fail closed;
- EASTHARLEM125 / DOB M01329447-I1 class must not corroborate an unrelated venue;
- KOKE remains LOW/audit-only without independent same-entity evidence.

## Expansion gate
No second jurisdiction and no generalized permit-to-sales-opportunity rollout until:
1. the current multi-source production path is versioned;
2. full graph replay exists;
3. the known cross-entity regression is closed;
4. subscriber backlog semantics and controlled end-to-end canary pass.
