# Event-time recency and truthful customer labels — 2026-09-21

## Release decision

Ship the typed event chronology and customer-report label correction. Retain V4 as **SHADOW_ONLY_NOT_PROMOTED**. Do not silently replace production V3, lower thresholds to restore volume, or rewrite historical benchmark expectations.

The live comparison exposed a material compatibility problem with the existing default 60-point cutoff. A separate score/threshold promotion decision is required before enabling V4. Issue #10 remains open for that work, independent validation, and a genuine subsequent publisher-refresh observation.

## Source semantics

NYC states that RECORD DATE is the date of the data pull. January 1, 1900 is an inspection-date placeholder for establishments not yet inspected. Neither field establishes an application filing date.

Primary publisher source checked in this run:
https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j

Government catalog corroboration:
https://catalog.data.gov/dataset/dohmh-new-york-city-restaurant-inspection-results

## Before-fix reproduction

Base: `1da246222557c860308cbfa3a144eae1a1af0306`.
Reproducer-only head: `7b7bf12198cb5bd6923d13451cf5aedb5e53cf23`.
Workflow `35663026688` failed as expected while the existing deterministic, material-change and provider suites remained green.

One synthetic cafe was evaluated at the same observation instant with identical business facts and no actual inspection. Only RECORD DATE changed from July 1 to September 21.

| Category | V3 older extract | V3 refreshed extract | V4 both extracts |
|---|---:|---:|---:|
| POS | 53 | 68 | 53 |
| Insurance | 50 | 65 | 50 |
| Equipment | 40 | 55 | 40 |
| Hood/Fire | 21 | 36 | 21 |
| Waste | 37 | 52 | 37 |
| Pest | 35 | 50 | 35 |
| Linen | 25 | 40 | 25 |
| Distribution | 43 | 58 | 43 |

This is a controlled reproduction, not a real customer or revenue outcome.

Before artifact `10667219475` was downloaded and inspected. ZIP SHA-256: `de83f82b7bc2158cf7e0ac9dc54805834a671601ad52b727fc6d8b282219584f`.

## Implemented chronology contract

`pipeline/event-time.js` distinguishes:

- latest known dated business event;
- exact source field/basis and source record;
- publisher dataset-pull date;
- PermitPlate observation instant;
- PermitPlate first-observation instant, only when supplied by evidence;
- PermitPlate detection instant, separate from filing time.

Authoritative event-date fields are DOHMH inspection_date, accepted SLA received_date, and accepted DOB filing_date. Only the primary and accepted same-entity records contribute. Missing accepted-source lookup, mismatched records, malformed dates, future event dates, and invalid observation instants require review.

Dates use publisher calendar precision. V4 evaluates age in America/New_York calendar days: 0–3 days = 15 points; 4–7 = 10; 8–30 = 5; older = 0. **Unknown age remains null and receives zero recency points.** This is a conservative proposed policy, not buyer-calibrated evidence.

An old filing's changed status or scope does not acquire a new source-event timestamp. Its initial filing date remains labeled as such. A first-seen observation is never substituted for a missing filing date.

## Customer-output change

New candidate packages freeze eventChronology without changing their existing numeric score authority. The subscriber artifact and finished text/HTML digest present internal JUST FILED applicants as **APPLICANT — NOT YET INSPECTED**.

CSV/report fields now separately expose Business Event Date, Business Event Basis, Event Time Status, Dataset Pull Date, PermitPlate Observed At, and PermitPlate First Observed At. Existing Detected At stays separate.

Legacy packages with no typed chronology display an unproven event date. Their sourceLatestEffectiveAt is not used to fabricate one. Bad stored chronology fingerprints cannot create a date claim. Digest copy explicitly identifies PermitPlate detection as not a filing date and distinguishes initial filing dates from later changes.

Scope: this corrects the internal subscriber artifact and digest generators. It is not a claim that an existing public-site example, older workbook output, or the stale Netlify deploy has been updated. Internal stage codes, raw sourceEffectiveAt, V3 scoring, and frozen benchmark evidence remain unchanged.

## V4 implementation and containment

`pipeline/shadow-scoring-v4.js` retains the existing non-temporal fit, stage, concept, corroboration, category ceiling and tie-break rules, but derives recency from typed accepted-source dates. It recomputes scores before clamping; subtracting 15 from an already-saturated V3 score would be mathematically incorrect.

Every V4 result is non-production-authorized. No V4 production score receipt, promotion record, transport permission, new price or altered subscriber cutoff is created by this change.

## Executed after-fix evidence

Code/test head: `2144e33b478646754db8d4072692959ad3276236`.

- Event-recency workflow `35663877583`, job `106545135211`: success.
- **36 focused checks passed; 0 failures; 0 skips.** New fixtures cover unknown dates, exact calendar buckets, bad/future dates, accepted/rejected source boundaries, old filings with new status, NYC calendar boundaries, score saturation, frozen-rule parity, and package/report/digest integration.
- The same downloaded source snapshot was rerun locally under Node 22.16.0 with the candidate-package, subscriber-artifact and customer-message suites: 39 top-level test results passed, including the same 36 focused checks.
- First-subscriber canary passed; NO_SEND; externalSendCalls 0; transport blocked by OWNER_AUTHORIZATION_MISSING.
- Frozen V3 historical replay: 47 records, exact row/fit/best-fit rates all 1.
- Seven protected files were compared byte-for-byte across before/after source archives: V3 scorer, scoring policy, canonical receipt builder, historical replay runner, and all three scoring JSON files. None changed.

These are authored synthetic checks plus a read-only live comparison, not independent third-party buyer validation. They do not meet a claim of externally blinded relevance calibration.

## Live comparison — not a customer-feed count

Observation: `2026-09-21T22:40:36.044Z`.
Graph: COMPLETE, **4,156 candidates**.
V4 scored all 4,156 without review errors.

Event-date basis:
- 3,791 unproven;
- 7 accepted SLA received dates;
- 358 actual DOHMH inspection dates.

3,821 candidates had at least one changed category score. This includes deliberate calendar-day and accepted-source date effects, not only decreases.

| Category | V3 candidate scores >=60 | V4 candidate scores >=60 |
|---|---:|---:|
| POS | 776 | 13 |
| Insurance | 773 | 8 |
| Equipment | 443 | 282 |
| Hood/Fire | 408 | 49 |
| Waste | 128 | 131 |
| Pest | 175 | 184 |
| Linen | 192 | 63 |
| Distribution | 735 | 347 |

These are raw current-graph score comparisons. They are **not** deliverable opportunities after subscriber baseline, new-event, territory, suppression and deduplication rules, and are not customer losses or sales forecasts.

A synthetic metadata-only transformation of 3,798 applicant candidates from that one fetched snapshot produced zero V4 score mismatches. It is not a second day's publisher observation. The canary did not write production state and verified its original state bytes were unchanged.

## Artifact verification

After artifact `10667918135` was downloaded and inspected. ZIP SHA-256:
`9013aa3f67f0bda4ba7104689485614f818bb401bb3180e9be93e32b703de005`.

Contents: event-time.tap, live-event-recency.json, first-subscriber.json, frozen-v3-sha256.txt, source-test-inputs.tar.gz. The source-only archive excludes customer/live state. Its hash matched GitHub metadata.

## Remaining release gate

Do not describe issue #10 as fully resolved or V4 as production:

1. Obtain independently judged relevant/irrelevant examples for the supported vendor categories; distinguish event recency from discovery recency and actionability.
2. Define compatible per-category ranking/cutoff behavior based on that evidence. Do not lower scores' thresholds merely to recreate legacy lead counts.
3. Prove a real subsequent publisher refresh through the persisted semantic ledger, not just a transformed in-memory snapshot.
4. Add explicit V4 authority/receipt promotion, rollback-to-review behavior, and full no-send profile/report tests at the selected thresholds. Never fall back silently to misleading extract-based freshness.
5. Audit remaining legacy/public sample/workbook surfaces before making broad freshness claims.

No email, customer outreach, fake subscriber/approval, live checkout change or hosting deployment was performed in this work. Existing production workflows may run when code is merged; the read-only canary's zero-write claim does not assert that unrelated or subsequently triggered workflows made no state commits.
