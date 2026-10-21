# PermitPlate Canonical Production Contract — 2026-09-18

This document records production behavior recovered from the latest PermitPlate operating history. It separates rules that are established from scoring details that remain unavailable and therefore MUST NOT be guessed during migration.

## Source families
Canonical production intelligence uses:
- NYC DOHMH;
- New York SLA;
- NYC DOB.

Source rows become immutable Source Events before venue-level interpretation.

## Venue identity and corroboration

### Established rules
1. Address/shared building/site is evidence of co-location, NOT venue identity.
2. SLA/DOB may corroborate a DOHMH venue only when the cross-source identity is genuine.
3. Shared-site DOB requires operator/DBA overlap OR matching unit/stall/suite evidence.
4. If that identity evidence is absent, building-level/shared-site DOB contributes:
   - zero stage benefit;
   - zero score benefit;
   - zero source-count benefit;
   - zero confidence benefit.
5. Contradictory stable same-namespace identifiers fail closed.
6. Cross-CAMIS predecessor evidence is not automatically current-venue evidence.

### Known false-match regression
DOB application `M01329447-I1` at the La Marqueta / 1590 Park Ave shared site was incorrectly linked to an unrelated venue through shared-site evidence. The canonical rule rejects that match unless independent entity/unit evidence exists.

## KOKE predecessor/re-permit correction
Established state after the September 18 correction:
- predecessor CAMIS: `50184059`;
- current CAMIS: `50192488`;
- predecessor had prior Pre-permit/Initial Inspection and closure history;
- predecessor evidence is suppression/audit context only, not current corroboration;
- current KOKE state: LOW confidence, audit-only, JUST FILED, DOHMH-only;
- Best Score: 28;
- Purchase Window: SUPPRESSED;
- prior score 100 is invalid/superseded.

The generalized predecessor/re-permit persistence rule was still IN PROGRESS at the last production checkpoint. Migration must preserve the known KOKE regression and fail closed for unresolved predecessor cases rather than invent a general relationship.

## Stage rules

### Established minimum triggers
- DOHMH applicant/current filing can support `JUST_FILED`.
- Exact/validated SLA licensing evidence can support a licensing/buildout stage.
- Exact/validated DOB hospitality buildout evidence can support a buildout/licensing stage.
- `HEALTH_PRE_PERMIT` requires an ACTUAL CAMIS-matched DOHMH Pre-permit event. Aggregate source counts or unrelated venue history are insufficient.
- Shared-site unmatched DOB cannot advance stage.
- Predecessor-CAMIS history cannot advance the current venue.

### Conservative migration rule
Do not auto-promote to a stronger stage unless its required canonical evidence is present. If the exact historical production trigger for a higher stage is unavailable, retain the lower supported stage and mark the stronger interpretation for review.

## Commercial fit
Production uses HIGH / MEDIUM / EXCLUDE commercial-fit outcomes.

Established behavior:
- institutional/corporate/non-actionable records may remain in the audit graph while being suppressed from customer delivery;
- fact and inference must remain separate;
- suppression is preferable to manufacturing a sales opportunity.

Exact historical numeric fit formulas are not recovered in the current evidence and MUST NOT be recreated from guesswork.

## Vendor-specific scores
Production has eight vendor-specific scores.

### Vertical Evidence Ceiling — established invariant
Equipment and Hood/Fire may outrank `max(POS, Insurance)` ONLY when supported by:
- direct category-specific DOB scope; OR
- explicit hot-food specialist evidence.

The following alone are NOT sufficient:
- generic restaurant/SLA evidence;
- stage;
- source corroboration;
- signs/awnings;
- generic building-level DOB evidence.

Known corrected examples after applying the ceiling:
- WILKIE: 85 -> 84;
- VOUNAROS: 97 -> 84;
- SSY TEA: 70 -> 60;
- DINER 24: 100 -> 92.

Exact formulas for all eight raw vendor scores are not recovered. Migration may enforce established invariants around scores, but MUST NOT invent missing raw-score formulas.

## Confidence
Production confidence includes HIGH / MEDIUM / LOW.

Established constraints:
- unmatched shared-site DOB gives zero confidence benefit;
- KOKE after predecessor/shared-site correction is LOW;
- confidence must reflect evidence quality rather than marketing importance.

Exact numeric confidence formula is not recovered and MUST NOT be guessed.

## Why Now / Purchase Window / Watch Next
These are production fields, but they must remain evidence-linked and clearly distinguish fact from inference.

Established states/constraints:
- KOKE Purchase Window is SUPPRESSED after the correction.
- Customer-facing copy must not imply a verified purchase intent or guaranteed opening.
- No meaningful change is suppressed from normal delivery.
- Watch Next may describe the next public event to monitor, not an invented event date.

## Subscriber baseline and backlog
Canonical semantics:
- `Baseline At` = Stripe subscription start.
- Normal feed = newly detected OR materially changed signals AFTER baseline.
- Prior backlog is NOT silently delivered as normal feed.
- Optional `Starter Snapshot` may include up to 10 still-active opportunities originally detected in the prior 7 days.
- Starter Snapshot is clearly labeled, preserves original detection dates, and uses exactly-once delivery keys separate from normal-feed keys.
- Subscriber filters include category, territory/borough, minimum score, suppression, ordering and dedupe.
- Synthetic owner-controlled no-send E2E must pass before paid delivery.

## Change-state semantics
Established labels:
- Newly detected;
- Stage advanced;
- Conflicting or stalled;
- No meaningful change.

No meaningful change is suppressed.

## Customer feedback labels
Established labels:
- Investigate now;
- Watch;
- Irrelevant;
- Already knew it.

## Migration rule
The current natural-language production automation remains authoritative only for behaviors explicitly recorded above or independently recovered. Deterministic code should replace it incrementally behind replay tests. Missing formulas/thresholds are migration blockers, not invitations to approximate.
