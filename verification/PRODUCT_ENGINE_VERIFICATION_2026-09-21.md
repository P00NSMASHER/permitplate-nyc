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

PermitPlate now separates payment/subscription authority from preference authority.

### Stripe subscription authority

The Stripe adapter validates:

- exact PermitPlate Payment Link;
- subscription mode;
- checkout complete;
- paid/no-payment-required state;
- PermitPlate project metadata;
- exact subscription object/id;
- active/trialing status;
- checkout email;
- exact expected price;
- Subscription.created as the service baseline.

Critical timing rule:

Baseline At = Stripe Subscription.created

It is NOT the pre-checkout form time, Checkout Session.created, or Payment Link open time.

Current live subscription identifiers:

- Payment Link ID: plink_1UG3RUDPW8riWrxQpZwHExK2
- Price ID: price_1UFjcWDPW8riWrxQhnrPX6nc

### Netlify preference authority

The preferred first-launch path is:

Netlify pre-checkout form
→ unchanged Stripe Payment Link
→ exact-email match
→ private subscriber profile

The onboarding receipt contains category, territory, Starter choice, version, plan and submission time. It is rejected when spam/honeypot-triggered, stale, future-dated relative to the subscription baseline, wrong-form, wrong-version, wrong-plan, invalid, or ambiguous.

The join key is exact normalized email within a bounded pre-checkout window. Business name, address and fuzzy matching are intentionally not used.

Stripe custom fields remain supported as an optional future preference source, but payment_links_write is no longer required for first launch.

Netlify Forms is enabled on the existing PermitPlate project. The new form is not yet live because production still serves the older deployment.

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
- delivered-key replay suppression;
- exact provider-evidence binding to Attempt ID, Message Identity, recipient and artifact fingerprint;
- immutable provider reconciliation receipts;
- idempotent provider-accepted replay;
- bounce/rejection state preservation;
- conflicting provider-message IDs fail to REVIEW;
- caller-supplied FINALIZED labels cannot create finalized private state.

Provider ACCEPTED means the configured provider accepted/bound the message event. PermitPlate does not call that proof that the message reached or was read in the recipient's inbox.

Private Delivery State is now derived through the provider-evidence boundary. A FINALIZED row requires:

1. a READY artifact and message;
2. the exact planned attempt;
3. valid owner send authorization at transport time;
4. provider evidence bound to that exact attempt;
5. consistent event/readback timestamps.

Synthetic first-subscriber NO-SEND canary verifies:

- Netlify pre-checkout preference receipt;
- unchanged Stripe subscription;
- exact-email activation;
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

Subscriber Profiles now has 21 columns while preserving the original audit fields.

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
- Checkout Session;
- Preference Receipt ID.

The Preference Receipt ID binds the private subscriber profile to the exact pre-checkout authority that supplied category/territory/Starter preferences.

Delivery State has 16 columns.

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

Validation rules exist for Starter boolean, subscription status, delivery status, delivery class and provider status.

Provider-derived rows expose the matched provider receipt to the mapping layer. Provider acceptance time is stored in the legacy Delivered At column, but is not described as inbox-delivery proof.

No fake subscriber or delivery rows were inserted.

## 14. Public deployment boundary

Netlify no longer publishes the repository root in source configuration.

The build:

- creates a dist directory;
- copies an explicit allowlist of public site files only;
- excludes pipeline, scoring, state, tests and implementation internals;
- emits build-info.json with source commit and public-file hashes;
- verifies local href/src/action references;
- verifies the Netlify form name, honeypot and required preference fields;
- verifies that public Start/Subscribe CTAs route through /start;
- verifies that the raw Stripe checkout URL appears only on the post-form handoff page.

Current verified onboarding deployment candidate:

- source commit: 6b99072631adbc9b1e2bb7e86c02fc7578f335d4
- artifact ZIP SHA-256: f56cd9bb2718d74b187a98fb9602a799a65979ab4de93726bbcd6a5dae1589d4
- public-source fingerprint: 6d583455c58f8168b8649570192acb8d56aac0634fce7f014f3d80fa04e5bbed

The public onboarding build includes start.html and start-checkout.html.

Current Netlify production deploy remains:

- deploy ID: 6aaecade31905a0008c5e43c
- commit: 57312ded8b2bcb3a95d4970ee0d8d4aadcb3dc0f

Netlify Forms is enabled for the project, but the live forms listing is currently empty because the stale production deployment does not contain the new form.

Multiple scoped upload attempts timed out during package/network resolution. Post-attempt readback confirmed that production did not advance.

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
2. The Netlify pre-checkout form running on the live production site.
3. Provider-backed acceptance/reconciliation for a genuine subscriber.
4. Next-run duplicate suppression after that genuine provider-backed event.
5. The verified onboarding public build running on Netlify production.

Stripe Payment Link write permission is not required for these proofs.

## 17. Remaining external blockers

### Netlify production deployment

This is now the primary integration blocker.

The existing site is healthy but stale. Netlify Forms is enabled, but live forms remain empty until the onboarding build is deployed.

The native connector can request a deploy handoff but cannot repair repository linkage itself. Scoped runtime upload attempts continue to fail during package/network resolution.

The connected Desktop Commander device PAAM-L044 is installed but currently offline, so it cannot execute the deploy handoff from the authorized machine at this time.

A future deployment may be verified by either:

- exact live Netlify commit matching the verified build commit; or
- exact live public-source/build-info fingerprint matching the verified public artifact.

### Commercial proof

After deployment, the remaining proof is one real paid subscriber completing owner-authorized transport, provider-bound reconciliation, and next-run duplicate suppression.

Stripe payment_links_write is optional and is no longer a first-customer launch blocker.

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
