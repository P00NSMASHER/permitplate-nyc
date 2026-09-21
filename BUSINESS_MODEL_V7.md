# PermitPlate Business Model V7

Updated: 2026-09-21

## Product definition

PermitPlate is evidence-backed public change intelligence for vendors that sell into businesses while those businesses are opening, licensing, building out, or materially changing.

The customer does not pay for a raw permit list. The customer pays for the right business, the meaningful change, the relevance to what they sell, and the official evidence behind it.

Current production market: NYC restaurant vendors.

## Current self-serve offer

NYC Restaurant Watch remains $79/month.

Target output:

- post-baseline new or materially changed opportunities;
- optional labeled prior-seven-day Starter Snapshot;
- vendor-category score;
- borough filtering;
- commercial fit;
- lifecycle stage;
- source systems and record IDs;
- official source URLs;
- CRM-ready report/CSV;
- exactly-once delivery state.

Initial categories:

- POS/payments
- Insurance
- Restaurant Equipment
- Hood/Fire Suppression
- Waste/Hauling
- Pest Control
- Linen/Laundry
- Food Distribution

## What the actual product now does

The current deterministic engine performs:

1. live source-health verification;
2. query-scoped source receipts;
3. conservative identity/project resolution;
4. cross-CAMIS predecessor suppression;
5. current candidate-graph construction;
6. evidence-backed commercial-fit classification;
7. canonical vendor-category scoring;
8. persistent first-detection/material-change tracking;
9. production-authorized candidate packaging;
10. persistent opportunity history;
11. subscriber baseline/territory/category filtering;
12. optional Starter Snapshot selection;
13. deterministic report/CSV generation;
14. deterministic attempt/message identity;
15. private delivery-state planning and reconciliation.

This is materially different from the earlier workbook/prompt-centric product.

## Ideal customer

A local or regional NYC vendor whose sales team benefits from learning about restaurant openings/buildouts before ordinary prospect lists catch up.

Strong buyers usually:

- earn enough gross profit from one account to justify $79/month;
- have a defined territory;
- sell during pre-opening/buildout/licensing;
- otherwise pay reps to research manually;
- value source evidence over opaque intent claims.

## Painful problem

Reps often discover a restaurant too late, spend time on false positives, or chase a building-level permit that is not actually tied to the target operator.

PermitPlate reduces that waste by failing closed on ambiguous identity and delivering changes rather than a giant undifferentiated list.

## Customer value unit

A useful signal should answer:

- Who is this?
- What materially changed?
- Why now?
- How relevant is it to what I sell?
- How strong is the identity/evidence?
- Which official records prove it?

## Product moat

1. Proof-carrying source windows.
2. Conservative cross-source identity.
3. Persistent baseline that prevents backlog leakage.
4. Canonical scoring with replay and adversarial tests.
5. Persistent production-authorized opportunity history.
6. Subscriber-specific deterministic artifacts.
7. Exactly-once delivery semantics.
8. Private customer state separated from public product code.
9. Safe static deployment boundary.

## Validated current scale

Recent live graph:

- approximately 4,104 current candidates;
- 82 cross-CAMIS operational conflicts suppressed;
- all promised source windows must be complete before delivery;
- canonical scoring covers the full current graph.

Scoring has passed:

- 47-case canonical historical replay;
- 13 of 13 current literal-authority overlap parity;
- adversarial evidence/scoring invariants.

This is technical validation, not market validation.

## Subscriber activation model

Target path:

Stripe $79 subscription
→ subscription.created becomes Baseline At
→ category preference
→ NYC territory
→ Starter yes/no
→ private subscriber profile
→ persisted opportunity filtering
→ deterministic report and CSV
→ operator-approved transport
→ provider reconciliation
→ private Delivery State

A synthetic NO-SEND canary proves this internal path, including next-run dedupe.

## Checkout improvement ready but blocked

The current $79 Payment Link does not yet collect PermitPlate preferences.

Prepared checkout fields:

1. required service-category dropdown;
2. optional NYC borough/territory text, blank meaning all NYC;
3. required Starter Snapshot yes/no.

The connected Stripe key currently lacks payment_links_write, so this live Payment Link change has not been applied.

No price, billing cadence, or tax change is required.

## Private production state

The private PermitPlate Google Sheet has been upgraded.

Subscriber Profiles now includes Starter settings, caps, subscription status, Stripe customer/subscription/price IDs, profile fingerprint, and Checkout Session ID while preserving prior baseline/audit fields.

Delivery State now includes delivery status, deterministic Message Identity, artifact/profile fingerprints, NORMAL/STARTER class, provider status, reconciliation timestamp, and Package ID.

No fake customer rows were inserted.

## Pricing

Keep the founding self-serve price at $79/month until real usage supports a pricing change.

Do not add pricing complexity before paid-customer proof.

Possible later packaging, only after usage evidence:

- team or multi-territory plans;
- more frequent delivery;
- CRM integrations;
- premium category-specific intelligence;
- additional jurisdictions.

## Founder-reviewed pilots

Use custom pilots for buyers/categories/markets outside the validated self-serve model.

A pilot should have an explicit buyer problem, source scope, territory/category, output, and price before work begins.

Do not describe a new market as production coverage until its source, matching, scoring, and buyer usefulness are validated.

## Validation metrics after launch

Most important:

- percent of delivered opportunities investigated;
- irrelevant rate;
- already-known rate;
- false-join/correction rate;
- source-window failure rate;
- delivered opportunities per subscriber;
- voluntarily reported conversation/customer outcomes;
- retention;
- cancellation reason.

Technical metrics remain necessary but are not substitutes for customer value.

## What PermitPlate should not claim

Do not claim guaranteed purchases, private purchase intent, guaranteed opening dates, complete coverage during unavailable/partial source windows, same-site permits as same-business evidence without proof, or a proven paid-customer delivery before one actually occurs.

## Current launch state

Internally ready:

- NYC official source ingestion;
- completeness receipts;
- candidate graph;
- identity/corroboration gates;
- commercial fit;
- canonical scoring;
- persistent detection state;
- persistent opportunity state;
- subscriber profile contract;
- deterministic report/CSV;
- exactly-once delivery planning;
- private subscriber/delivery schema;
- synthetic first-subscriber NO-SEND acceptance;
- deploy-safe public-site artifact.

Externally blocked:

1. Stripe checkout preference fields need payment_links_write permission.
2. Netlify production deploy is stale and the scoped upload helper still times out.
3. No real paid subscriber has completed provider-backed delivery/reconciliation.

## Immediate operating priority

Do not expand geography.

The next commercial milestone is one genuine $79 subscriber completing preference capture, receiving an operator-approved PermitPlate artifact, and reconciling provider/delivery state with zero duplicate delivery on the next run.

That event moves PermitPlate from technically launch-ready to commercially proven.
