# NYC V4 — owner-authorized internal production scoring

**Mode:** `V4_EVENT_TIME_SOURCE_RELEVANCE_PRIVATE_NO_SEND`  
**Owner authorization:** October 21, 2026; scoped record: `scoring/nyc-v4-internal-owner-authorization.json`  
**Private product artifact:** `state/nyc-v4-internal-scores.json` in the configured private PermitPlate state repository. Never publish that private operational file on the public website or in public Actions artifacts.

## Operational meaning

The actual NYC source-relevance engine uses the existing **V4 event-time scorer**, then caps numeric research priority by the category's authenticated official evidence. It is **live internal production scoring** for source research, not an approved customer scored-lead feed. The existing $79/month `FOUNDER_CURATED_NO_SCORE_V1` customer offer and independent factual review requirements remain unchanged.

The owner approved internal ranking without a second **code reviewer**. The authorization does not assert that any model predicts buying intent, business opening, actual vendor demand, customer conversion, or calibrated buyer probability. Precision and recall stay `null` until real source-bound independently adjudicated outcomes exist. The previous legacy V3 scored-customer promotion canary can still correctly report `CURRENT_OVERLAP_TOO_SMALL`; a zero-overlap historical snapshot cannot justify fake parity. Do not lower it merely to obtain green status.

## Production algorithm

1. Reuse the **same complete and fresh** DOHMH, DOB NOW, and SLA public batches from the private research refresh. Require closed pagination and exact publisher count; reject a partial, stale, inconsistent or changed graph, disputed source values, or invalid owner-scoring policy.
2. Require a valid CAMIS, verified NYC borough, unsuppressed jurisdiction/identity, and source-consistent graph digest/materiality. Hold records flagged as institutional/excluded.
3. **Only rank a candidate with a real, separately dateable official business event:** a DOHMH pre-permit inspection, accepted SLA application-received date, or reviewed DOB initial filing tied to the same verified entity. A DOHMH `record_date` refresh or `1900-01-01` uninspected placeholder earns **no** new-event score.
4. Compute V4's source-event-timed heuristic, **never V3's extraction-time recency**, and cap the per-category research relevance: `SOURCE_KEYWORD_CONTEXT` at **79**, `RELATED_OFFICIAL_ACTIVITY` at **54**, and `APPLICANT_CONTEXT_ONLY` at **39**. These are **heuristic ceilings, not validated cutoffs**. A cited keyword or related source does not prove a purchase.
5. Sort deterministic internal research rows by bounded score, actual event date and CAMIS; attach source event, evidence bases and fingerprints. Preserve every withheld candidate in aggregate counts. Only source-linked research data is written; no payment, customer, subscriber or email data is included.

**Fail closed:** The scorer returns `REVIEW` and no rankable rows for source/graph/policy integrity failures. The private job validates the complete score snapshot hash, requires monotonic private timestamp when an earlier snapshot exists, and writes JSON atomically with the standard 0600 private-mode file helper. Publication still uses the existing exact-main, permission-scoped compare-and-swap private Git writer. No new workflow runner, credential, service, customer payment or external contact mechanism is added.

## Distinct authorizations

| Field | Meaning |
| --- | --- |
| `internalProductionAuthorized: true` | Private staff may use this score as a source-research triage metric. |
| `productionAuthorized: false` | This is **not** an existing `SCORED` customer or score receipt. |
| `customerDeliveryAllowed: false` | The customer delivery planner cannot use it as a scored feed. |
| `externalSendCalls: 0` | No report, email, advertisement, Stripe transaction or outbound message was sent. |
| `accuracy.verifiedBuyerPrecision: null` | Buyer relevance and commercial precision have not been independently measured. |

## Real-world acceptance snapshot (October 21, 2026)

A source-locked PAAM-L044 replay at `2026-10-21T15:00:49Z` fetched **5,522 DOHMH + 5,381 DOB NOW + 2,932 SLA** official rows and reconciled each publisher count. It found **4,274** CAMIS candidates: **368** ranked with known event dates, **3,764** undated held, **132** source/identity suppressed and **10** institutional/excluded fit. Ranking scores were **37–54**, with **0** independently verified buyers or outbound sends. This is a point-in-time source-coverage diagnostic, not measured precision, sales lead volume, or permanent production data.

A clean-room private-state bootstrap and a second repeated scan both passed. The second pass recorded **zero** spurious newly observed restaurant events despite the fresh data-extract clock.

## Private founder research board

The same authenticated main-only curated refresh now prepares **three additional
private outputs** directly from its already-verified V4 snapshot and source graph:

- `state/nyc-v4-review-workbench.html` — responsive, offline, script-free
  evidence review board with source links, dates, and the top 16 entries per
  vendor category. No tracking pixels, fonts, scripts, forms or contact buttons.
- `state/nyc-v4-review-workbench.csv` — all internally ranked records across
  eight vendor categories, including source evidence and blank owner source,
  independent buyer-need, notes and disposition fields. CSV formula injection
  is escaped. Blank fields **do not mean the claim is verified**.
- `state/nyc-v4-review-workbench-receipt.json` — source, score, output-integrity
  hashes, category totals and explicit `ownerApproved:false`,
  `customerDeliveryAllowed:false`, and `externalSendCalls:0`.

The private board makes the daily source-based ranking actionable for the
operator, but **does not change which restaurants are eligible for a paid
brief**. Category relevance remains a bounded heuristic and any claimed buyer
demand requires evidence and explicit per-record owner assessment. A user must
not forward the board/CSV as a customer lead list or treat the numerical values
as predicted sales. Existing first-subscriber Stripe verification, category
attestation, customer delivery approval, provider readback, and suppression
controls remain entirely separate.

When checking a record, open its exact official dataset link and CAMIS public
inspection link, verify name/premises and category suitability, then write an
actual evidence-based conclusion in a **separate private editable copy** of
the CSV. No automated process treats that copy as a signed or approved
customer decision. The next daily refresh may replace the generated blank
worksheet; do not edit the generated workbench artifact in place.

The refresh **rejects** invalid V4 score hashes, graph/source observation
mismatch, suppressed or cross-tenant CAMIS, altered timestamps, nonofficial
links, and unsafe presentation before any new private publication. All files
are committed only by the existing private Git state writer and must never be
added to the public GitHub Pages allowlist or public Actions artifacts.

## Verification and rollback

On an exact candidate or current source revision:

```sh
node pipeline/nyc-v4-internal-production-scoring.test.js
node pipeline/curated-product.test.js
python -m unittest discover -s tests -p test_curated_workflow_policy.py
```

Require passing owner-CI tests, original public-source/graph checks, existing blind benchmark/source QC, private state monotonicity, real no-send transport gates and the existing production refresh's `internalProductionScoringActive=true` summary. If the source becomes partial or contradictory, **do not** promote rows or loosen guardrails. Diagnose the exact source and restore the last valid private score snapshot; do not force-update public `main` or rewrite private history. An ordinary reverting PR disables new internal scoring publication, while the preexisting founder-curated no-score customer workflow remains authoritative. Never use an old score snapshot unless its version, source digest, freshness and hash match the current trusted graph.
