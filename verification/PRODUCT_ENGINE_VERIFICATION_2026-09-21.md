# PermitPlate Product Engine Verification — 2026-09-21

## Verification purpose

This record captures the current PermitPlate product state after the 2026-09-21 hardening work.

It distinguishes:

- deterministic product capabilities that are implemented and regression-tested;
- live public-source behavior that has been observed;
- private production state that has been prepared;
- external launch blockers that remain;
- behaviors that are intentionally NOT claimed.

## 1. Public-source ingestion and completeness

Implemented:

- query-scoped SourceObservation receipts;
- canonical source IDs for NYC DOHMH, DOB NOW and NY SLA;
- source freshness checks;
- schema fingerprints;
- raw-page hashes;
- publisher-count versus fetched-count closure;
- explicit SOURCE_UNAVAILABLE, SOURCE_MOVED, PARTIAL, UNKNOWN, VERIFIED_EMPTY and COMPLETE_NONEMPTY states;
- fail-closed absence semantics.

Verified behavior:

- missing/null publisher count does not become zero;
- a partial fetch before transport failure preserves positive records but cannot prove absence;
- verified-empty requires count proof plus an actual scoped empty data page;
- stale source metadata cannot authorize absence;
- all promised source windows are required before the customer graph is COMPLETE.

## 2. Identity and ProjectSignal

Implemented:

- DOHMH CAMIS-centered candidates;
- stable-ID contradiction handling;
- same-address is co-location, not identity;
- accepted versus rejected corroboration;
- explicit reviewed identity bridges;
- source-linked commercial evidence;
- cross-CAMIS operational-predecessor suppression.

Regression anchors:

- KOKE current CAMIS 50192488 versus predecessor CAMIS 50184059;
- shared-site La Marqueta DOB M01329447-I1.

Verified result:

- KOKE remains suppressed;
- rejected shared-site DOB evidence receives zero commercial/scoring benefit.

## 3. Live candidate graph

Recent live graph validation produced approximately:

- 4,104 current candidates;
- 3,798 JUST FILED;
- 306 HEALTH PRE-PERMIT;
- 82 cross-CAMIS operational conflicts suppressed.

The graph is digest-bound and replayable.

A source-health failure cannot silently produce a COMPLETE graph.

## 4. Commercial fit

Implemented versioned CommercialFit receipts.

Current outcomes include:

- HIGH;
- MEDIUM;
- LOW;
- EXCLUDE;
- REVIEW when evidence is insufficient.

Recent live graph fit coverage was complete across the current candidate set.

Important calibration:

- evidence sufficient to prove a commercial prospect is separated from stronger evidence required for specialist score boosts;
- brick-oven naming alone does not prove hot-food specialist evidence;
- rejected auxiliary evidence cannot improve fit;
- operational-predecessor conflicts remain LOW/suppressed;
- institutional/residential/corporate-floor contexts remain EXCLUDE.

## 5. Canonical scoring

Current internal production scoring mode:

CANONICAL_V3_WITH_LEGACY_FALLBACK

Canonical scorer:

permitplate-shadow-score-v3-2026-09-21

Promotion evidence:

- full current-graph scoring coverage;
- 13/13 current literal-authority overlap parity;
- 47-case canonical historical production replay;
- adversarial scoring invariants;
- no-send scoring-promotion canary;
- committed canonical-v3 promotion record.

Documented historical literal anomalies intentionally NOT copied into the canonical model:

1. CAMIS 50192386 — legacy Hood/Fire 100 versus canonical 93.
2. CAMIS 50192550 — legacy Distribution 89 / Insurance best versus canonical Distribution 94 / Distribution best.

Safety behavior:

- if fresh canonical gates fail, a still-valid literal authority may be used as rollback/fallback;
- if neither authority is valid, scoring goes to REVIEW;
- rejected same-site DOB evidence adds zero points;
- signage-only DOB identity cannot mint hospitality/kitchen boosts;
- recency cannot inflate a score;
- missing phone cannot add phone points;
- EXCLUDE remains all-zero;
- scores remain bounded 0–100.

## 6. Persistent detection state

Implemented:

- persistent detection ledger;
- deterministic ledger fingerprint;
- baseline bootstrap;
- NEW_ENTITY and MATERIAL_CHANGE receipts;
- OUT_OF_CURRENT_WINDOW state;
- REAPPEARED_REVIEW state;
- fail-closed incomplete-graph behavior.

First live bootstrap:

- approximately 4,104 baseline entries;
- zero customer-eligible detections;
- no backlog leakage.

Subsequent live replay:

- zero false new detections when the graph had not materially changed.

## 7. Candidate packages and opportunity ledger

Implemented:

- graph-bound candidate packages;
- exact detection receipt embedded;
- exact production-authorized score receipt embedded;
- source systems, source record IDs and official URLs frozen into the package;
- deterministic package ID/fingerprint;
- persistent opportunity ledger;
- idempotent event key = entity plus change fingerprint;
- conflict rejection;
- tamper detection.

The detection workflow is transactional:

detect
→ score/package
→ append opportunity ledger
→ commit detection and opportunity ledgers together

If packaging/scoring fails, the persistent detection state is not advanced.

This behavior was observed when an integration defect was caught before state commit.

Current live opportunity ledger initialized cleanly with zero false opportunity events after baseline.

## 8. Subscriber profile contract

Implemented deterministic private subscriber profile model.

Required/normalized fields include:

- subscriber/subscription ID;
- recipient email;
- subscription-created Baseline At;
- explicit service category;
- NYC borough territory;
- minimum score;
- Starter Snapshot opt-in;
- Starter days, maximum 7;
- Starter limit, maximum 10;
- report cap, maximum 25;
- subscription status;
- Stripe customer/subscription/price IDs;
- deterministic profile fingerprint.

No subscriber email or Stripe customer data is stored in the public GitHub repository.

## 9. Stripe subscriber adapter

Implemented checkout-to-profile adapter.

Fail-closed checks include:

- exact PermitPlate Payment Link;
- subscription mode;
- checkout complete;
- paid/no-payment-required state;
- PermitPlate project metadata;
- subscription object present;
- active/trialing subscription;
- customer email present;
- category preference present;
- Starter preference present.

Critical timing rule:

Baseline At = Stripe Subscription.created

It is NOT Checkout Session.created.

Current live subscription link:

- Payment Link ID: plink_1UG3RUDPW8riWrxQpZwHExK2
- Price ID: price_1UFjcWDPW8riWrxQhnrPX6nc

Prepared preference fields:

- required service-category dropdown;
- optional NYC territory text, blank = all NYC;
- required Starter Snapshot yes/no.

Blocker:

The connected Stripe key still lacks payment_links_write, so these fields have NOT been applied to the live $79 checkout.

## 10. Subscriber artifact and customer digest

Implemented deterministic subscriber artifact selection from the persistent opportunity ledger.

Applies:

- borough filter;
- selected categories;
- best score among requested categories;
- minimum score;
- baseline rules;
- Starter rules;
- total and Starter caps;
- already-delivered signal-key suppression.

Output:

- ordered report rows;
- matching ordered CSV rows;
- official source URLs;
- source record IDs;
- evidence tags;
- production package IDs;
- deterministic artifact fingerprint.

CSV formula-like values are neutralized.

Customer digest renderer produces:

- concise subject;
- NORMAL section;
- separately labeled STARTER section;
- escaped HTML;
- official HTTPS source links only;
- matching CSV attachment;
- deterministic message-content fingerprint;
- NO_SEND when there are zero qualifying signals.

## 11. Exactly-once delivery planning

Implemented:

- deterministic signal keys;
- deterministic delivery attempt ID;
- deterministic message identity;
- provider-observation reconciliation;
- delivered-key replay suppression;
- idempotent provider-accepted replay.

Synthetic first-subscriber NO-SEND canary verifies:

- subscription-created baseline;
- one NORMAL signal;
- one STARTER signal;
- email/CSV parity;
- finished customer digest;
- deterministic planned attempt;
- exact private sheet row plans;
- second run returns zero signals after delivered keys are supplied;
- externalSendCalls = 0.

## 12. Explicit owner transport authorization

External transport is fail-closed by design.

A real send requires a short-lived OWNER_EXPLICIT_SEND authorization receipt bound to:

- exact Attempt ID;
- exact Message Identity;
- exact artifact fingerprint;
- exact message-content fingerprint;
- exact recipient;
- exact ordered signal set;
- approval time;
- expiry time;
- one-time authorization nonce/ID.

Guards:

- missing approval blocks;
- mismatched attempt/message/artifact blocks;
- recipient mismatch blocks;
- signal-set mismatch blocks;
- expired/future/overlong authorization blocks;
- reused authorization ID blocks.

Synthetic first-subscriber canary intentionally runs with NO owner authorization and transport preflight must fail with OWNER_AUTHORIZATION_MISSING.

No email is sent by this canary.

## 13. Private production state

Private Google Sheet:

PermitPlate NYC Dashboard

Subscriber Profiles was expanded to 20 columns while preserving the original audit fields.

Added private fields include:

- Starter Snapshot Enabled;
- Starter Days;
- Starter Limit;
- Max Signals;
- Status;
- Stripe Customer;
- Stripe Subscription;
- Price ID;
- Profile Fingerprint;
- Checkout Session.

Delivery State was expanded to 16 columns.

Added private fields include:

- Delivery Status;
- Message Identity;
- Artifact Fingerprint;
- Profile Fingerprint;
- Delivery Class;
- Provider Status;
- Last Reconciled At;
- Package ID;
- Authorization ID.

Validation rules were added for Starter boolean, subscription status, delivery status, delivery class and provider status.

No fake subscriber or delivery rows were inserted.

## 14. Public deployment boundary

Netlify no longer publishes the repository root in source configuration.

The build now:

- creates a dist directory;
- copies an explicit allowlist of public site files only;
- excludes pipeline, scoring, state, tests and model implementation;
- emits build-info.json with source commit and public-file hashes.

A GitHub Actions deploy-ready public artifact was built and independently verified.

Verified artifact:

- source commit: a2d8c43f84a060a55f3fd325d6c50f2fde646cd3
- artifact ZIP SHA-256: 3d86cc6424307b07be7aeed18c272a313a44d429dcb0bd2d392062c5b4510f9f

Netlify production deploy remains stale.

Current known deploy ID:

6aaecade31905a0008c5e43c

Multiple scoped upload attempts timed out during package/network resolution. Post-attempt project readback showed that the deploy ID did not advance.

No successful deploy is claimed.

## 15. What is currently proven

Proven internally:

- live public-source ingestion;
- fail-closed source completeness;
- conservative entity resolution;
- current graph;
- commercial fit;
- canonical category scoring;
- persistent baseline/change detection;
- persistent production-authorized opportunity history;
- subscriber profile normalization;
- deterministic subscriber artifact;
- customer digest rendering;
- exactly-once attempt/delivery logic;
- private state mapping;
- explicit owner authorization gate;
- no-send first-subscriber acceptance;
- safe static deployment artifact.

## 16. What is NOT yet proven

Not yet proven:

1. A real $79 PermitPlate subscriber completing the full production path.
2. Live checkout preference capture on the current $79 Payment Link.
3. Provider-backed customer delivery/reconciliation for a genuine subscriber.
4. The new public-site build running on Netlify production.

## 17. Remaining external blockers

### Stripe

Required permission:

payment_links_write

Until granted, the live subscription Payment Link cannot collect category/territory/Starter preferences directly.

### Netlify

The existing site is healthy but stale.

The native connector can request a deploy handoff but cannot repair the repository linkage, and the scoped runtime upload command continues to fail during external package/network resolution.

## 18. Next commercial proof

The next meaningful product milestone is not another algorithm.

It is:

One genuine $79 subscriber
→ preference capture
→ subscription-created baseline
→ production opportunity selection
→ operator-reviewed customer digest
→ explicit owner send authorization
→ provider-backed delivery
→ private delivery-state reconciliation
→ next-run zero duplicate delivery.

Until that happens, PermitPlate should be described as technically launch-ready with external integration blockers, not commercially proven.
