# PermitPlate — Current-source blind calibration kit

The `PermitPlate real-source blind calibration kit (private)` workflow
prepares a **new, time-bound research instrument** using complete NYC
Health Department, DOB NOW and State Liquor Authority source observations.
It does **not** activate scoring or send customers anything.

## Privacy and independence

Every weekly run (or explicitly requested dispatch) writes one
append-only directory in the dedicated private state repository:

`research/blind-calibration/RUN_ID/`

The folder contains:

- `reviewer/review-workbench.html` — browser-openable, locally rendered
  blind evidence questions with **no model scores** and no automatic upload.
- `reviewer/review-packet.json` — the corresponding blind cards and
  source links, without v3/v4 predictions or hidden holdout cases.
- `operator/cohort.json` — model predictions, case grouping, tuning/holdout
  assignments and exact source/model-code fingerprint. **Do not share with
  independent reviewers.**
- `operator/label-readiness.json` — an expected blocked receipt because
  there are not yet two independent human reviews.
- `operator/source-provenance.json`, `summary.json`, and `README.txt`.

The private `research/blind-calibration/LATEST.json` points to the latest
successful run ID. Only aggregate counts and fingerprints may appear in CI
logs. The cohort and reviewer data are never uploaded as public Actions
artifacts. No customer or payment data are read.

## What is and is not proven

The workflow uses the current verified NYC source window, exact approved
public-main commit and hash-pinned source/scoring/evaluation code. Its
reviewer packet contains only evidence. It contains a deterministic site
group sample, with diagnostic cases excluded from threshold selection.

### Focused first calibration: Equipment

To make genuine independent review achievable, the active weekly packet now
targets **Equipment** only. It still samples 100 eligible site groups, with
70 tuning and 30 hidden holdout cases. No diagnostic extras or POS/Insurance
judgments are required for this first Equipment-focused evaluation.
Two independent reviewers must each judge the full 70-case first packet.
The 30-case hidden holdout remains unavailable until thresholds are locked.
All minimum precision, reviewer agreement, coverage and holdout checks remain
unchanged. The older three-category research packet remains archived privately,
and separate POS and Insurance calibration is deferred, not silently passed.

The exported review JSON is the *only* way to supply actual human judgments;
the instrument never fills labels automatically and cannot attest to human
expertise. No one has been contacted or given access to private material.

The packet is **not a validated lead feed**. It does not prove a restaurant
is about to open, a customer will buy, or any model's precision.

Actual calibration still requires two genuinely independent expert reviews,
conflict resolution, a frozen tuning threshold, independent holdout review
and manual acceptance against the existing promotion policy. Synthetic or
model-generated labels cannot satisfy these requirements. The workflow
never sets `productionAuthorized=true`.

## Runtime and release protections

The source checkout must be exact current `main` before private credentials
are made available and is rechecked after collection and immediately before
the private push. All private state writers share the same serialized
concurrency group; commits are append-only and non-force. No new Stripe
capabilities, email sending, paid APIs or scoring-policy mutations are used.

Use `node pipeline/calibration-runner.js lock ...` and
`evaluate ...` **only after** authorized independent reviewers supply
real source-backed judgment exports and their identities/independence are
confirmed. Until then the correct operator status is `BLOCKED`.
