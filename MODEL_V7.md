# PermitPlate Model V7

Updated: 2026-09-21

## Design goal

PermitPlate converts official public records into evidence-backed commercial change intelligence without allowing a high score, a shared address, a transient source failure, or old backlog to masquerade as a safe customer signal.

The production model is now a deterministic pipeline rather than a prompt/workbook-only workflow.

## Current runtime architecture

Core decision runtime: PermitPlate-v7.1.0.

Operational flow:

Official public source
→ SourceObservation receipt
→ normalized SourceRecord
→ same-entity ProjectSignal
→ current candidate graph
→ commercial-fit receipt
→ canonical category-score receipt
→ persistent detection ledger
→ production-authorized candidate package
→ persistent opportunity ledger
→ private subscriber profile
→ deterministic subscriber artifact
→ planned delivery identity
→ private delivery-state reconciliation

Current production scoring policy: CANONICAL_V3_WITH_LEGACY_FALLBACK.

External transport remains operator-controlled. Internal readiness does not mean that a customer email has been sent.

## Source completeness

Every monitored source window is classified as VERIFIED_EMPTY, COMPLETE_NONEMPTY, PARTIAL, SOURCE_UNAVAILABLE, SOURCE_MOVED, or UNKNOWN.

A complete receipt binds the source, connector configuration, exact query fingerprint, observation time, freshness, schema fingerprint, raw-page hashes, publisher count, fetched count, and cursor closure.

Missing or null counts never become zero.

Only VERIFIED_EMPTY or COMPLETE_NONEMPTY may support absence conclusions. A positive record fetched before a later failure may remain positive evidence, but the failed window cannot prove absence.

## Current promised source set

NYC restaurant intelligence currently uses:

- NYC DOHMH Restaurant Inspection Results, dataset 43nn-pn8j
- NYC DOB NOW Job Application Filings, dataset w9ak-ipjd
- NY State Liquor Authority Pending Licenses, dataset f8i8-k2gm

The current graph is COMPLETE only when every promised source window is complete or verified empty.

## Identity and ProjectSignal

Important invariants:

1. Same address is co-location evidence, not identity.
2. A conflicting stable identifier fails closed.
3. DOHMH CAMIS identities remain distinct unless authoritative evidence bridges them.
4. SLA corroboration requires safe same-premise/business identity.
5. DOB same-site work does not corroborate a restaurant merely because it is in the same building.
6. Rejected cross-source evidence contributes zero scoring benefit.
7. Reviewed identity bridges are explicit and auditable.

Known regression anchors include KOKE current CAMIS 50192488 versus operational predecessor 50184059, and La Marqueta shared-site DOB M01329447-I1.

## Current candidate graph

Recent verified live graph:

- approximately 4,104 candidates
- approximately 3,798 JUST FILED
- approximately 306 HEALTH PRE-PERMIT
- 82 cross-CAMIS operational conflicts suppressed

The graph has a deterministic digest.

## Commercial fit

Commercial fit is versioned evidence, not an informal label.

Dispositions are HIGH, MEDIUM, LOW, EXCLUDE, or REVIEW.

Current rules separate evidence that establishes a commercial prospect from stronger evidence that unlocks specialist scoring.

Examples:

- clear restaurant, pizza, cafe, or accepted hospitality-source evidence can establish HIGH;
- a current DOHMH applicant with unclear concept remains MEDIUM;
- operational-predecessor conflicts are LOW/suppressed;
- institutional, residential, and corporate-floor contexts are EXCLUDE;
- a brick-oven name can support HIGH fit without automatically unlocking hot-food specialist boosts.

## Category scoring

Categories are POS, Insurance, Equipment, Hood/Fire, Waste, Pest, Linen, and Distribution.

Canonical scorer: permitplate-shadow-score-v3-2026-09-21, promoted for internal production scoring.

Validation includes:

- full live-graph scoring coverage;
- 13 of 13 current literal-authority overlap parity;
- 47-case canonical historical replay;
- adversarial score invariants;
- no-send promotion canary;
- committed promotion record.

Two documented legacy score anomalies remain preserved as audit evidence rather than copied into the new model:

- CAMIS 50192386: legacy Hood/Fire 100, canonical 93
- CAMIS 50192550: legacy Distribution 89 with Insurance best, canonical Distribution 94 with Distribution best

If fresh canonical gates fail, a still-valid LEGACY_LITERAL score can be used as fallback for that unchanged candidate. Otherwise scoring goes to REVIEW.

## Scoring invariants

- Rejected same-site DOB evidence adds zero points.
- Signage-only identity evidence cannot create hospitality/kitchen boosts.
- Only accepted source evidence may unlock category-specific DOB boosts.
- Recency may decay a score but cannot increase it.
- Public-phone points require observed phone evidence.
- EXCLUDE rows are all-zero.
- Scores are integer-bounded from 0 to 100.
- Score receipts bind graph digest and candidate change fingerprint.
- Customer delivery requires productionAuthorized true.

## Detection ledger

PermitPlate persists first-observed and material-change state.

Initial bootstrap marked all existing graph candidates BASELINE_EXISTING and customerEligible false. This prevents current backlog from being delivered as new.

Future customer-eligible classes are NEW_ENTITY and MATERIAL_CHANGE.

Disappearance from the rolling monitored window becomes OUT_OF_CURRENT_WINDOW, not business closure. Reappearance becomes REAPPEARED_REVIEW, not an automatic commercial reopen.

The ledger refuses to advance on an incomplete graph or a bad fingerprint.

## Candidate package and opportunity ledger

A production candidate package freezes:

- graph digest;
- exact change fingerprint;
- exact detection receipt;
- exact production-authorized score receipt;
- project signal;
- business/location/stage fields;
- source systems and record IDs;
- official source URLs;
- commercial evidence;
- category scores;
- best vendor fit and score.

Only READY_FOR_PROFILE_MATCHING packages may enter the opportunity ledger.

The opportunity ledger is keyed by entity plus change fingerprint, is idempotent on exact replay, and fails on conflicting replay.

Detection and opportunity ledgers are committed atomically.

## Subscriber profile

Subscriber data remains private and is not stored in the public GitHub repository.

The profile contract includes:

- subscription ID;
- recipient email;
- exact baseline time;
- one or more categories;
- NYC borough territory;
- minimum score;
- Starter Snapshot opt-in;
- Starter days, capped at 7;
- Starter limit, capped at 10;
- total signal cap, capped at 25;
- subscription status;
- Stripe customer/subscription/price IDs;
- deterministic profile fingerprint.

Omitted territory means all five NYC boroughs. Category is never guessed.

## Stripe baseline rule

Baseline At equals the Stripe Subscription created timestamp.

It is not the time the buyer opened the Checkout Session or Payment Link.

The Stripe subscriber adapter fails closed on wrong link, wrong mode, incomplete/unpaid checkout, missing subscription, ineligible subscription status, wrong project metadata, missing email, missing category preference, or missing Starter preference.

## Starter Snapshot

Starter Snapshot is optional.

When enabled:

- only opportunities already persisted in the opportunity ledger may qualify;
- detection time must fall in the prior seven days;
- the item stays labeled STARTER;
- original detection time is preserved;
- maximum Starter items is 10;
- normal and Starter signal keys use separate namespaces.

PermitPlate does not reconstruct arbitrary historical source rows as recent Starter opportunities.

## Subscriber artifact and delivery

A subscriber artifact is deterministic from the subscriber profile, opportunity ledger, and delivered signal keys.

It applies boroughs, categories, threshold, baseline/Starter rules, caps, and exactly-once suppression.

Report and CSV use the same ordered signal keys. CSV formula-like values are neutralized.

Private Delivery State tracks recipient, signal key, delivered time, Stripe IDs, provider message ID, Attempt ID, Message Identity, artifact/profile fingerprints, NORMAL/STARTER class, provider status, reconciliation time, and package ID.

## Current no-send acceptance

Synthetic first-subscriber path has been verified:

completed Stripe subscription
→ subscription-created baseline
→ private profile
→ persistent opportunity ledger
→ one NORMAL plus one STARTER signal
→ email/CSV parity
→ deterministic planned message identity
→ exact private-sheet row plan
→ delivered-key replay
→ zero second-run signals

External send calls: 0.

This is not evidence that a real paid subscriber has received PermitPlate.

## Deployment boundary

Netlify now builds an explicit public-file allowlist into a dist directory rather than publishing the repository root.

The public artifact contains only website assets plus build-info.json. Backend pipeline, tests, scoring authority, and state files are excluded.

## Current external blockers

1. Netlify production has not advanced to the verified public build. The scoped upload helper still times out during package/network resolution.
2. The connected Stripe key lacks payment_links_write, so the $79 Payment Link cannot yet collect category, territory, and Starter preferences directly.
3. No real paid PermitPlate subscriber has completed provider-backed delivery/reconciliation yet.

These are external integration/transport blockers, not unresolved source, identity, scoring, detection, or artifact-model blockers.

## Expansion rule

Do not add a second jurisdiction until one real paid-customer delivery is executed and reconciled without weakening the NYC evidence gates.
