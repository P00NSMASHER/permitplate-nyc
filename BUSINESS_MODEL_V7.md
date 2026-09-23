# PermitPlate NYC business model

Version: 8.0
Updated: September 23, 2026

## Product promise

PermitPlate helps companies that sell to restaurants decide which NYC projects deserve research now. It converts selected official applicant, licensing, buildout, pre-permit, and material-change records into short evidence-first briefs.

PermitPlate does not sell purchase intent, opening predictions, exclusive leads, or guaranteed daily volume. A signal means the cited public evidence may justify research; it does not mean the business will open, needs a vendor, or will buy.

## Target customer

The self-serve plan supports one of eight vendor categories:

- POS and payments;
- insurance;
- equipment;
- hood and fire;
- waste;
- pest control;
- linen;
- distribution.

The buyer chooses all NYC, one borough, or a supported borough combination. Multi-category, custom-market, and consulting work remain separately scoped founder-reviewed engagements.

## Offer and price

The self-serve plan is $79 per month with no setup fee. It renews until canceled. Customers can use the Stripe-hosted customer portal to update account or payment details, view invoices, and cancel at the end of the billing period.

The first subscription payment has a voluntary seven-calendar-day refund window. Confirmed duplicate charges, charges after an effective cancellation, and confirmed billing errors are refunded.

Keep this price and a single self-serve tier until real customer usage supports different packaging.

## What the customer receives

A qualifying brief can include:

- business name and normalized NYC venue;
- lifecycle stage;
- What Changed;
- Observed Facts;
- PermitPlate interpretation / Why Now;
- Watch Next;
- source IDs and official links;
- identity and evidence confidence;
- category-specific research priority;
- a CRM-safe CSV that uses the same ordered signal set.

Reports are produced when qualifying activity is available for the subscriber's category and territory. Some days may have no report. A brief is capped at 25 signals.

The normal feed begins at the Stripe subscription baseline. An optional first-fulfillment Starter Snapshot may include up to 10 still-active opportunities first detected during the prior seven days. Starter items are always labeled as active before the customer joined.

## Public-source scope

NYC DOHMH is the core restaurant source. NYC DOB and New York State Liquor Authority records may add corroborating evidence when source status, identity, recency, and venue-matching gates pass.

Public records may be delayed, corrected, incomplete, duplicated, or unavailable. Partial or unavailable source windows fail closed: they cannot support absence conclusions or state advancement that would require a complete source window.

## Stripe-authoritative onboarding

The active Stripe Payment Link is the payment and preference authority. Checkout requires:

1. one supported vendor category;
2. one supported NYC territory;
3. Starter Snapshot yes/no;
4. checkout email and business name.

Activation requires the expected Payment Link and price, a completed paid subscription checkout, an active or trialing subscription, valid project metadata, checkout email, and all three required preference fields. The completed Checkout Session ID is the preference receipt. Missing or invalid values fail closed.

The separate Netlify onboarding form and exact-email preference join are retired. No customer preference is written to the public repository.

## Delivery controls

Customer artifacts are deterministic from the validated source graph, subscriber profile, persisted opportunity state, and delivered keys.

No external send is authorized merely because an artifact exists. The delivery path requires explicit owner authorization bound to the exact message identity, recipient, and artifact. Provider acceptance must reconcile to that exact attempt before delivery state can finalize. Provider acceptance is not described as inbox delivery.

## Private operational state

Detection and opportunity ledgers must not advance in the public application repository. Scheduled workflows read and write a dedicated private state repository using the configuration documented in `operations/PRIVATE_STATE_MIGRATION.md`.

Until that private repository and its scoped credentials are configured, stateful workflows fail closed. The public repository retains only aggregate counts, gate states, and cryptographic fingerprints.

## Metrics after launch

Customer-value metrics:

- investigated rate;
- irrelevant rate;
- already-known rate;
- false-join or correction rate;
- voluntarily reported conversations and wins;
- retention and cancellation reason.

Operational metrics:

- source-window completeness;
- artifact and provider acceptance rate;
- duplicate-suppression rate;
- delivery reconciliation failures;
- time from qualifying evidence to reviewed brief.

Technical success does not substitute for customer value.

## Launch state

Verified in deterministic tests and NO-SEND canaries:

- source normalization and completeness receipts;
- conservative graph building and evidence joins;
- event-time and material-change rules;
- eight-category scoring and frozen historical benchmark;
- detection and opportunity ledger semantics;
- Stripe custom-field subscriber activation;
- deterministic report/CSV generation;
- exactly-once delivery planning;
- private-state and public-build boundaries;
- explicit send authorization and provider reconciliation.

Live commerce configuration verified September 23, 2026:

- active $79/month Stripe subscription checkout;
- required category, territory, and Starter fields;
- truthful product description and variable-cadence language;
- Stripe-hosted customer portal with cancellation;
- one controlled public checkout entry point.

The correct commercialization label is **ready for a controlled first paid subscriber**. PermitPlate is not commercially proven until one genuine subscriber completes provider-backed delivery/reconciliation and the next run proves duplicate suppression.

## Immediate priority

Do not expand geography or add pricing complexity. Configure the private state boundary, run one paid-subscriber acceptance with explicit owner review, reconcile the provider receipt, and verify that the next run emits no duplicate signal.
