# Material change versus source refresh — verification, 2026-09-21

## Product result

PermitPlate now distinguishes a change to a public dataset extract from a change to a business/project. An otherwise identical DOHMH applicant no longer produces a customer-eligible MATERIAL_CHANGE just because RECORD DATE changes. Actual inspection events and accepted SLA/DOB status, scope, or cost changes remain detectable.

This is a source-to-opportunity quality fix, not proof of a paid customer, an email delivery, or a successful website deployment.

## Publisher semantics

NYC's publisher description explicitly defines RECORD DATE as the date of the data pull. It separately describes 1900-01-01 as the inspection-date placeholder for establishments not yet inspected, and notes that inspection fields repeat for additional violation records.

Official source inspected:
https://catalog.data.gov/dataset/dohmh-new-york-city-restaurant-inspection-results

Publisher API documentation:
https://dev.socrata.com/foundry/data.cityofnewyork.us/43nn-pn8j/embed

These facts justify treating extraction timestamps, generated row hashes and violation-row formatting as distinct from new opening/permit activity.

## Executed before-fix reproduction

Original product base: `562e4201303899b831cf2fe71e370af4cbba2270`.
Reproducer-only commit: `00748a6239dc83a0008eac8a159b502c31eaa0af`.

- Workflow `35656178507`, job `106520299884` failed the new negative control as expected.
- Only the synthetic DOHMH applicant's RECORD DATE was changed across two complete normalized graphs.
- Expected customer events: 0. Actual customer events: 1.
- The positive control, a real pre-permit inspection change, passed.
- The pre-existing full deterministic suite (`35656178468`) and provider suite (`35656178467`) were green, showing that their prior coverage did not detect this defect.

Initial failure artifact: ID `10663539076`; ZIP digest reported by GitHub `11abd97837c0fd53fbebde3de7802e34f27c8446370c51436bafd5217f59a102`. This artifact is the deliberately failing reproduction, not evidence that the corrected implementation failed.

## Implemented boundary

`pipeline/material-change.js` creates a versioned semantic descriptor with independently hashed identity, premise, lifecycle, suppression, source membership, accepted event content and evidence-tag components.

Only accepted source records contribute semantic event content. Rejected co-location evidence does not create a sales event.

DOHMH material event dates use actual inspection dates and exclude the 1900 placeholder and RECORD DATE. DOB and SLA descriptors retain stable filing/application IDs and relevant event dates, status, scope/license class and cost.

Raw records, source IDs, extraction times, original provenance and raw graph bindings are still preserved. A distinct semantic comparison decides whether a customer event exists; changing a hash or an extract time alone is not enough.

An accepted filing's content can change while its ID stays constant. Both the candidate receipt binding and graph digest now include semantic content, so a changed status/scope/cost cannot reuse the old score receipt merely because the filing ID is unchanged.

## Review versus automatic customer event

The following do not automatically become customer changes:

- source refresh alone;
- generated raw-row/ProjectSignal hash changes;
- violation/grade corrections with unchanged inspection event;
- name, address or borough corrections;
- suppression/identity-conflict changes;
- lifecycle regression;
- accepted evidence leaving a rolling source window;
- reappearance without separate reopening proof.

Identity corrections, evidence loss and suppression changes retain explicit review receipts. A new unsuppressed entity or a supported material event after an established semantic baseline can produce the existing NEW_ENTITY/MATERIAL_CHANGE classes. Normal customer profile, scoring and send-authorization checks still apply afterward.

## Safe migration and its deliberate limitation

The old ledger has raw fingerprints but not a historical semantic snapshot. A raw hash cannot prove whether the only intervening difference was a refresh, or whether a genuine business change also occurred.

The first complete observation therefore produces MATERIALITY_MIGRATION_REVIEW for existing legacy entries. It preserves initializedAt, firstObservedAt, prior customer-event times/classes, the prior raw fingerprint and a durable review receipt while establishing the new descriptor. It does not rebrand the backlog as new leads.

Important limitation: changes spanning that one-time legacy-to-semantic transition require review; this migration does not claim to recover their true historical materiality or backdate their discovery. This is a conservative review boundary, not proof that all businesses were unchanged.

Missing ledger fingerprints, invalid semantic descriptors, malformed nonempty uninitialized history and regressing observation times fail closed. The runner no longer silently turns an existing malformed history into a fresh baseline.

No production state file was manually rewritten in this PR. The read-only pre-merge canary did not persist its proposed migration. After merge, the existing transactional detection/package/opportunity workflow may apply it; only a separate state-commit readback can establish that it actually did.

## Executed after-fix evidence

Tested code head: `1860f3e19f672951722ec36539d2c3290f47b278`.

- Material-change workflow `35657258572`, job `106523864732`: success.
- New focused suite: **29 tests passed, 0 failed, 0 skipped**.
- Full deterministic regression `35657258550`: success.
- Provider reconciliation regression `35657258627`: success.
- First-subscriber synthetic test remained NO_SEND with externalSendCalls 0 and transport blocked by OWNER_AUTHORIZATION_MISSING.

The 29 checks include false-refresh reproduction, real inspection positive controls, accepted same-ID SLA/DOB changes, rejected co-location, corrections/review, immutable migration, missing/tampered history, time rollback, deterministic ordering and post-change replay.

### Synthetic bulk regression

A completely synthetic set of 4,104 applicants was normalized twice with only the extract date changed. The result was 4,104 refresh-only observations and **0 customer events**.

This is a controlled regression result, not a claim that 4,104 real emails were prevented.

### Live read-only migration and frozen-snapshot simulation

Observed at `2026-09-21T21:27:28.446Z`:

- Live graph state: COMPLETE.
- Current candidates: 4,104.
- Proposed legacy entries migrated in memory: 4,104.
- Migration review receipts: 4,104.
- Customer events from proposed migration: 0.
- Original state bytes and input object unchanged: true.
- Production state writes by this canary: 0.

A separate, explicitly synthetic transformation of that fetched snapshot advanced only pull metadata for its 3,798 applicant candidates. It produced **3,798 refresh-only observations and 0 customer events**. This is not a second day's live observation and does not establish empirical long-term false-positive rates.

## Artifact independently inspected

Workflow artifact `10664977170`, name `permitplate-material-change`, was downloaded and inspected.

ZIP SHA-256:
`ebdbc4bec34aac8e310e5685ff3d0dd08763ca59a47a271dd697a84e15e67673`

Files:
- `source-refresh.tap`
- `materiality-live-readonly.json`
- `first-subscriber.json`

The locally computed ZIP digest matched GitHub's artifact metadata. No local execution of the product test suites is claimed; those suites ran in GitHub Actions under Node 22.

## Scope limits and next proof

This change fixes detection materiality and receipt/graph invalidation. It does not rewrite every existing sourceEffectiveAt/recency score calculation, approve the accuracy of JUST FILED presentation, or establish a genuine application filing date for uninspected DOHMH applicants. A separate event-time versus extraction-time ranking/presentation audit remains appropriate before making quantified freshness claims.

Semantic descriptors and fingerprints are deterministic integrity/binding tools, not signatures or proof that arbitrary caller-supplied JSON is authentic. They are produced inside the existing trusted source/identity pipeline, not accepted as browser-authoritative facts.

The next operational proof is an actual subsequent publisher refresh through the persisted semantic ledger, showing refresh-only counts separated from reviewed and customer-eligible changes. The separate commercial blocker remains production deployment of the verified onboarding flow and a genuine paid, explicitly authorized delivery/reconciliation cycle.

No customer email, external outreach, fake customer/approval row, price change or Netlify deployment was performed by this PR.
