# Blind category calibration — 2026-09-21

## Release decision

Ship the review instrument, not a new production cutoff. V3 production, V4 shadow scorer, canonical authorization, frozen historical expectations, subscriber thresholds, live state and transport are unchanged. Issue #10 remains open.

The deliverable is a functioning score-blind review workbench plus a reproducible cohort/threshold/holdout evaluator. No buyer judgments are invented. The actual initial result is BLOCKED because independent review evidence is absent.

## Why this is needed

The preceding event-time fix showed that removing unsupported recency points changes the score distribution. Preserving the old number of leads is not a calibration objective. A numeric score of 60 does not have a stable interpretation across different formulas, and these scores are not probabilities.

The review target is narrower and testable: does the accepted public evidence justify a vendor spending time researching this business now? It is NOT a prediction that the business will buy, a guaranteed opening date, a recovery amount, or a customer conversion measure.

Public date semantics were rechecked against the NYC publisher: RECORD DATE is the extraction date; 1900-01-01 inspection dates denote establishments not yet inspected. No extraction time is offered as a new filing date.

Official source: https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j

## Implemented components

- `pipeline/calibration-cohort.js`: complete-graph-only sampling, frozen revision and code hashes, source-evidence allowlist, site grouping, score-blind reviewer projection, protected holdout release.
- `pipeline/calibration-evaluation.js`: input provenance checks, independent-review consensus, per-category threshold selection, Wilson lower bounds, separately locked heldout assessment, no automatic promotion.
- `pipeline/calibration-workbench.js`: standalone responsive reviewer interface with local export/resume. No network requests, analytics, automatic storage, customer messages or provider integrations.
- `pipeline/calibration-runner.js`: prepare / lock / holdout / evaluate commands. Existing output files are not overwritten. The default run reads public sources and leaves production state unchanged.
- `pipeline/calibration.test.js`: 42 focused synthetic contract and adversarial tests.
- `.github/workflows/category-calibration.yml`: read-only verification and artifact retention. No schedule was added.

## Sampling and blindness

Default categories: POS, Insurance, Equipment. The underlying cohort function supports any subset of the eight existing categories. Extending a study requires an explicitly frozen new cohort; it is not a license to tune against already-viewed holdout labels.

The default benchmark chooses 100 eligible site groups through deterministic hash sampling, independent of their scores, with one hash-selected eligible entity per selected group. 70 groups are assigned to tuning and 30 to holdout. Address grouping uses normalized address plus borough, with entity fallback when the address is absent. It is an evaluation separation rule, not a claim that co-located entities are the same business. Address aliases can still require review.

An additional 24 diagnostic cases cover dated evidence, old/new cutoff disagreement, undated cases, and suppression/review cases. Diagnostics are deliberately oversampled and NEVER enter threshold quality metrics. They are useful for finding failure modes, not estimating prevalence.

The estimand is one eligible entity per sampled site group in one current graph. It is NOT all restaurants, not a venue-weighted population estimate, and not a subscriber-delivery feed. Actual new-event eligibility, subscriber baseline, and delivery caps require separate validation before promotion.

Reviewers receive only `reviewer/`. The `operator/` directory contains the frozen predictions and hidden holdout cases and must not be shared with reviewers. Reviewer cards contain names/locations, truthful stage/date fields, accepted official source references, and selected domain facts. Phone, email, officer, owner and applicant-contact fields are excluded. Neither model scores nor sampling buckets are embedded in the HTML. Holdout cards are absent from the first reviewer packet.

## Review labels

Each completed judgment requires an opaque reviewer ID, declared domain role, an independent-human-review attestation, source record reference, reason, evidence fingerprint and review timestamp.

Labels:

- PURSUE_NOW: evidence supports spending research effort now; this is not confirmed intent.
- WATCH: plausible category fit without sufficiently timely action evidence.
- NOT_RELEVANT: wrong category/identity or unsuitable prospect.
- INSUFFICIENT_EVIDENCE: a valid non-actionable judgment, not a fabricated negative business fact.

At least two distinct reviewers must independently agree for a case/category to be usable. Missing judgments and disagreements remain explicit and block locking; they do not become silent negatives, model-generated labels, or majority-vote truth. Keep originals private. No adjudication workflow is implemented in this version, so unresolved disagreement must not be overwritten to manufacture agreement.

Reviewer-role strings and hashes do not authenticate expertise or independence. Operator verification of actual reviewer provenance remains a mandatory external gate. Synthetic test fixtures exercise the interface but do not supply real labels.

## Precommitted advisory threshold policy

These are chosen engineering acceptance gates, not published industry benchmarks or statistically guaranteed buyer outcomes:

- Candidate cutoff grid: 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80.
- Minimum tuning sample: 50 fully adjudicated/independently agreed cases per category.
- Minimum heldout sample: 30 cases per category.
- Minimum selected support: 20 cases.
- Observed precision for PURSUE_NOW: at least 0.80.
- Lower end of the nominal 95% Wilson interval: at least 0.60.
- Declared reviewer agreement gate: at least 0.80; unresolved individual disagreements independently block this first implementation.

The tuning choice maximizes supported useful cases subject to those gates, then favors fewer false positives and the more conservative threshold on ties. It never tries to reproduce the old feed count. If no threshold qualifies, the answer is NO_THRESHOLD_JUSTIFIED.

Only after a threshold lock exists can a heldout reviewer packet be released. The holdout evaluator assesses the one locked cutoff per category and the existing V3 60-point comparator; it does not search another grid on holdout. Repeated review of the same holdout is not enforced by cryptographic access control; the operator must retire a holdout that has influenced changes. Same-site split checks reduce leakage but do not create future-date generalization.

Even a passing holdout produces only ELIGIBLE_FOR_MANUAL_REVIEW_ONLY, always productionAuthorized=false. Buyer evidence quality, actual cross-day publisher refresh, subscriber event-feed behavior, and an explicit promotion of a separately versioned policy remain required.

Primary methodology references:

- https://scikit-learn.org/1.9/modules/classification_threshold.html — separate threshold tuning from model training and unseen evaluation; avoid overfitting.
- https://scikit-learn.org/stable/modules/cross_validation.html — keep grouped observations out of both training and test folds.

No scikit-learn dependency was added; the implementation is dependency-free Node.js and uses a predeclared local protocol.

## Executed live read-only preparation

Inspected/tested branch head: `03ae5939d2f01d6bf2c4ee613378cbb1396b0b06`.

CI tested merge/source revision recorded in the generated cohort: `327998a181df9b2bb7cffe0649b2992cced36529`.

Observation: `2026-09-21T23:01:19.242Z`.

- Graph: COMPLETE, 4,156 candidates.
- Eligible for this research panel: 4,054 candidates across 3,437 normalized site groups.
- Benchmark: 100 cases, split into 70 tuning and 30 heldout.
- Diagnostic: 24 additional cases, excluded from benchmark metrics.
- Initial score-blind workbench: 94 visible cases, 282 possible category judgments per reviewer.
- Holdout released: false.
- Genuine independent reviews received: zero.
- Threshold lock: BLOCKED.
- Production scoring mode: CANONICAL_V3_WITH_LEGACY_FALLBACK.
- External sends: zero.
- Production state writes: zero; existing detection/opportunity files unchanged.

Cohort ID: `COHORT-8a8ac581e313ef5df03c6fbe`.

Cohort fingerprint: `51f0d3cd96d95d0e48c92d5f6a7efb95884f65af13224374f0e10f321f5d36f6`.

This same-day observation is not longitudinal refresh validation. A complete graph and generated review kit are not completed commercial validation.

## Verification actually run

- 42/42 new synthetic safeguard tests passed locally and in CI.
- Downloaded source was separately replayed locally with event-time and historical scoring tests: 79/79 top-level test results passed, no skips.
- First-subscriber canary retained NO_SEND, zero external sends and OWNER_AUTHORIZATION_MISSING.
- Full deterministic, provider-reconciliation, material-change, event-time and new calibration workflows all succeeded at the tested head.
- New-code bytes in the downloaded CI source archive matched the locally inspected/tested files.
- Browser smoke test on a synthetic-only review: empty export refused; one labeled synthetic judgment exported with isSynthetic=true; paging retained edits; importing restored the review. No fake review was generated for the live packet.
- Actual unreviewed live packet rendered at 1440, 768, 390 and 320 pixels with no horizontal overflow. All 19 pages checked at 320px. Zero JavaScript errors and zero external network requests. No live judgments created.
- Browser rendering used the generated HTML content in local Chromium; this environment blocked file-URL navigation, so operating-system file-opening behavior itself was not tested.

CI runs:

- Blind calibration: `35665556812`
- Full deterministic: `35665556946`
- Provider reconciliation: `35665556719`
- Material change: `35665556698`
- Event-time recency: `35665556700`

Downloaded artifact: `10669605806`.

ZIP SHA-256: `824ef1a3a9f74990686999d2dff32b27347fa83cf6bf537be63c9e4d0836cdc3`.

The artifact was downloaded, hash-checked, inspected and separately replayed. It contains unreviewed public-source evidence and code, not actual private reviewer labels.

## Next acceptance gate

Obtain two independently produced, source-referenced domain reviews for the tuning panel; then lock only a justified cutoff and release the untouched holdout. Do not use assistant-generated opinions as those independent reviews. No outreach is authorized or performed by this change.
