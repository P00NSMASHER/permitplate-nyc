# PermitPlate NYC product and system contract

Version: 8.0
Updated: September 23, 2026

## System objective

PermitPlate creates auditable NYC restaurant-project research briefs from selected official public records. The system optimizes for evidence quality, repeatability, and safe suppression—not maximum lead volume.

## Source observations

Each source read produces an explicit observation state. Complete non-empty and verified-empty windows can support absence conclusions. Partial, unavailable, or invalid windows cannot.

The core source is NYC DOHMH. NYC DOB and New York State Liquor Authority records are corroborating sources and must pass their own status, time, and identity rules before contributing commercial evidence.

Publisher metadata, extraction time, business-event time, first-detection time, and public-site build time are separate clocks. Dataset metadata and DOHMH RECORD DATE are never promoted to filing or opening dates.

## Identity and corroboration

DOHMH CAMIS is the core source-local entity key. Cross-source joins require supported venue identity. Exact address alone does not prove common ownership or a common project; ambiguous co-location stays rejected or under review.

The graph retains accepted and rejected evidence with reasons. Weak or conflicting identities can suppress delivery even when individual source rows are otherwise valid.

## Lifecycle and scoring

The current product uses four lifecycle stages:

1. JUST FILED;
2. BUILDOUT / LICENSING;
3. HEALTH PRE-PERMIT;
4. MULTI-SOURCE NEAR-OPENING.

Eight deterministic category scores prioritize research for POS, Insurance, Equipment, Hood/Fire, Waste, Pest, Linen, and Distribution. Scores are not probabilities. Category ceilings prevent unsupported specialist evidence from being inflated.

Canonical V3 remains the production authority with the frozen historical benchmark. V4 event-time recency is evaluated separately and cannot silently replace the production score authority.

## Material change and state

Extraction refresh, source-row order, formatting-only differences, and regenerated hashes are not customer events. New business-event evidence, accepted status change, accepted project-scope change, or another validated semantic change can create a customer event.

Detection state distinguishes baseline, present, review, and material customer events. Opportunity state preserves first-detection time and delivered keys for exactly-once behavior.

Operational ledgers belong in the private state repository described in `operations/PRIVATE_STATE_MIGRATION.md`. The public repository ignores `state/` and `.private-state/`. Stateful workflows fail closed when the private boundary is unavailable.

## Stripe subscriber activation

The production path is:

- completed PermitPlate Stripe Checkout;
- expected Payment Link and price;
- required category, territory, and Starter custom fields;
- active or trialing subscription;
- normalized private subscriber profile.

`subscription.created` is the customer baseline. The Checkout Session ID is the exact preference receipt. Category is never guessed; territory values are normalized against the supported borough contract.

Activation fails closed on wrong link, wrong mode, incomplete or unpaid checkout, missing subscription object, wrong price, ineligible status, wrong project metadata, missing email, or missing/invalid custom fields.

## Subscriber artifacts

Artifacts are deterministic from the subscriber profile, opportunity ledger, and delivered keys. Normal and Starter items have distinct key namespaces. Starter items must already exist in opportunity state, remain active, fall within seven days, and stay within the limit of 10. Total signals are capped at 25.

Report and CSV use the same ordered signal keys. CSV formula-like values are neutralized. Customer-facing content separates observed source facts from PermitPlate interpretation.

## Send authorization and reconciliation

The default canary transport is NO_SEND. A real send requires an unexpired owner authorization bound to recipient, message identity, artifact fingerprint, and attempt.

Private Delivery State records Stripe IDs, recipient, signal keys, NORMAL/STARTER class, artifact/profile fingerprints, package, authorization, provider message and attempt IDs, provider status, acceptance time, and reconciliation time.

Caller-supplied FINALIZED state cannot authorize delivery. Provider evidence must match the exact attempt. ACCEPTED means the provider accepted the request; it is not a claim of inbox delivery.

## Public deployment boundary

`build-site.js` copies an explicit allowlist to `dist/`. Backend pipeline code, operational files, state, tests, model documents, Netlify files, and secrets are excluded.

The canonical site is GitHub Pages at `https://p00nsmasher.github.io/permitplate-nyc/`. The Pages workflow builds the artifact, deploys it, and verifies live `build-info.json` against the source commit and aggregate public-source fingerprint.

All local absolute links must remain under `/permitplate-nyc/`. The public conversion regression ensures only `start.html` contains the active Stripe Payment Link and that the browser cannot bypass required Stripe preferences.

## Readiness states

- **INTERNAL_BLOCKED**: current source graph, scoring, state, or canary gates are incomplete.
- **EXTERNAL_INTEGRATION_BLOCKED**: internal gates pass but checkout or verified hosting does not.
- **READY_FOR_FIRST_PAID_CUSTOMER**: internal and external launch gates pass; real-customer proof is still pending.
- **PAID_CUSTOMER_PROVEN**: paid delivery, provider reconciliation, and next-run duplicate suppression are verified.

Source unavailability can temporarily make a live run INTERNAL_BLOCKED by design. It must not be bypassed by describing stale or partial records as current opportunities.

## Current proof boundary

All deterministic regression tests and the synthetic first-subscriber NO-SEND canary pass. Stripe custom fields and the customer portal are live. No real paid PermitPlate subscriber has completed provider-backed delivery and next-run dedupe proof; that evidence must never be fabricated.
