# PermitPlate NYC — production founder-curated product lane

This runbook is for the real paid offer, **FOUNDER_CURATED_NO_SCORE_V1**. It
does not promote the experimental score or authorize sending without a separate
owner-approved, provider-reconciled attempt.

## Customer contract

Stripe is authoritative for a completed subscription, the exact $79/month
PermitPlate price, email, category, territory, Starter preference and
subscription-created baseline. A new customer receives a founder-reviewed
official-source brief (up to ten signals), or a no-matches note, within five
business days and weekly thereafter. The first seven-day Starter Snapshot is
optional. Do **not** promise an opening, guaranteed sale or exclusive lead.

## 1. Independent live research

The `PermitPlate curated research (private)` workflow scans official NYC
sources, replays the complete candidate graph and stores these files only in
the **dedicated private state repository**:

- `state/curated-research-ledger.json` — the stable first-observed timestamp,
  current verified semantic descriptor, and (where independently detected) last
  source-material-change event per CAMIS, including out-of-window history.
- `state/curated-current-graph.json` — the current graph and official-source
  observation receipts. No customer data or scored opportunity packages.
- `state/curated-baseline-anchor.json` — the immutable initialization anchor
  that prevents accidentally resetting one missing ledger file.

The first valid scan creates a baseline with **zero new signals**. Subsequent
complete scans identify newly observed CAMIS identities and can detect a
material change in a *previously verified, accepted* DOB/SLA/DOHMH semantic
evidence descriptor. Only source-evidence changes without identity, address,
suppression, status regression, or lost corroboration are eligible for human
review. Data-extraction `record_date`, generated row hashes, tag-only changes,
reappearing entities, incomplete sources, or unverifiable identity changes
never manufacture customer events.

On the first deployment of versioned semantic evidence, existing private V1
ledger entries are **migrated in place without resetting their first-observed
dates**. Their first new semantic descriptor is comparison baseline only;
no claim of a historical change is inferred. Future verified deltas produce
unique, fingerprint-bound material-event IDs. One event per entity is retained
as the latest current change, without claiming a prior vendor lead was new.

The research snapshot and ledger are committed together in the private
repository. Main-only runtime and no-force push protect against concurrent
writes. A failed scored-opportunity package does **not** block this independent
research history and does not change the scored ledger.

The workflow never contacts customers, publishes paid candidate state to
public GitHub, or exercises a payment API.

## Full construction evidence and official building keys

DOB job descriptions are now captured **in full**, with original length,
SHA-256 text checksum, source fact fingerprint, current publisher observation,
specific component terms, action verbs, and explicit repair/existing-context
flags. The old 180-character `sourceExcerpt` remains a non-authoritative
preview for compatibility. A description is never an equipment order or
purchase intent.

**October 19 follow-up correction — false scan-ID changes.** The first
implementation also hashed the changing source-observation ID into each
durable full-scope fingerprint. Its second production refresh therefore
reported 93 construction-scope rechecks even though an independent comparison
of the prior and subsequent private receipts established **93 unchanged
original description hashes**, **93 changing observation IDs**, and **zero
changes to the underlying official fact hashes**.

The corrected semantic fingerprint hashes only the official record identity
and complete description content. Daily observation IDs remain in the
separate provenance/receipt, but cannot manufacture a content event.
One-time migration uses the exact previous private review's original
checksums; it does not reinitialize first-seen dates. Historic alerts from
the older flawed receipt are retained for traceability but marked as
requiring re-verification, not silently represented as verified source
changes. Missing or altered historical evidence fails closed.

The historic independent-source ledger learns a new full-scope hash on its
first upgraded scan **without creating a material event**. Later changes
beyond the 180-character preview trigger a source-context recheck, retain
first-seen times, and cannot authorize customer sends.

NYC Geosupport defines a seven-digit borough followed by six zeroes
(e.g. `3000000`) as a **million BIN**, a placeholder meaning the building
identifier is unavailable. These values must not be compared as real BINs.
If DOB BIN is specific but DOHMH supplies a million BIN, PermitPlate
uses available BBL corroboration only, and clearly records the invalid raw
placeholder. On October 19, 2026, independent public DOB/DOHMH requery
identified two same-site hypotheses falsely held as BIN conflicts because of
`3000000`; a third case had a genuine BBL disagreement and remains held.

For exact-address CAMIS-to-DOB hypotheses, the private reviewer workbench
compares source-provided DOB and DOHMH **BIN**, and (only when supplied)
DOB borough/block/lot against DOHMH **BBL**. Conflicting official identifiers
are presented first with a clear manual hold. Matching identifiers can
corroborate a physical site but **never** establish that the property owner
is the restaurant operator. Missing identifiers remain unresolved. No
automatic identity bridge, scored lead, or customer delivery is permitted.

## Source-selected, blind construction review and reserved audit

The daily private scan now creates a **separate, reproducible** construction
review split. Its reviewer packet is
`state/construction-blind-reviewer.json`, while the reserved
`state/construction-reserved-audit.json` is strictly for future separate
source-audit work. `state/construction-blind-manifest.json` records the
source-bound fingerprints, strata and full counts. These are **not**
the original Equipment scoring holdout or validated customer leads.

Cases are grouped by **physical borough/address**, ensuring different
DOB filing numbers and subfilings at one premise cannot cross between
reviewer and reserved partitions. Each official job-number root must also
remain in a single physical premise; the process rejects contradictory
source identity rather than splitting it. Review assignment uses a
constant SHA-256 order within source-context strata, independent of
model scores and reviewer opinions.

The first packet preserves entire original DOB descriptions, the exact
official source link and source fingerprints. It deliberately omits
synthetic rule classifications, model predictions and reserved cases.
The reserved file is withheld from the first-stage reviewer workflow.
Because the underlying full source corpus exists in private Git, this is an
**operational access separation**, not a claim that reviewers cannot obtain
the same public official filings elsewhere.

The selection is from restaurant-related DOB filings, not a random customer
population. Two genuine independent expert reviews and operator/contract
identity evidence are still required for commercial validation.
The original `70 tuning / 30 scored holdout` files are not accessed,
modified, or replaced. No calibrated score may be promoted from this panel.

## Independent full-scope construction diagnostic (not scored calibration)

The source refresh creates three additional **private** artifacts:
`state/construction-validation-panel.json`,
`state/construction-validation-panel.csv`, and
`state/construction-validation-summary.md`. They cover the uncapped
restaurant-related DOB review records in that same complete official scan,
using the **full original job_description**, verified source observation,
filing date/status, source content fingerprint and explicit scope terms.

Every filing remains `customerDeliveryAllowed: false`. The diagnostic
compares a broad category-context keyword rule with a stricter component
plus action rule; any agreement is only between two deterministic text
rules, NOT independent expert validation, measured buyer precision, or an
actual equipment order. Entries are grouped by job-number root for
correlation awareness, not falsely treated as independent customer sites.

Exact-address CAMIS links are reported as review-only hypotheses.
Official BIN/BBL mismatches are flagged as identity conflicts and
physical-site matches do **not** identify the restaurant tenant.

**Calibration firewall:** this job does not read, change, or sample from
the separate private blind Equipment tuning / hidden holdout archive.
The original 70-case tuning and 30-case holdout remain frozen and sealed.
The new source-rich panel must not be merged into those case labels or
used to claim an unbiased precision result. Future genuine review of
this source-selected population requires a new, explicitly declared
calibration protocol and independent judgments.

## 1A. Earlier DOB/SLA research (review-only)

The same complete source scan also creates
`state/independent-source-review.json` inside the **private** state repository.
It contains recent DOB restaurant-related construction filings and NYC SLA
restaurant/premises applications with official direct-record URLs, actual
filing/received dates, and bounded source excerpts. It excludes clearly
residential projects, non-NYC counties, old/future dates and records already
independently linked to CAMIS. Matching addresses are flagged for identity
review, never assumed to be the same business.

The review-only feed also maintains `state/independent-source-history.json`.
Every DOB/SLA source ID retains its actual **first observation by PermitPlate**
across repeated scans, even when an official record leaves the rolling query
window and later returns. It distinguishes `NEW_TO_PERMITPLATE`,
`SOURCE_CONTEXT_CHANGED_FOR_REVIEW`, and `ALREADY_OBSERVED`.
These describe research monitoring, **not** original filing dates, actual
project changes, future openings, or customer buying intent. The raw official
filing/received date remains separately labeled `sourceEffectiveAt`.

On deployment, the existing private DOB/SLA queue is used once as the
historical baseline; previously found records are not treated as new. The
history ledger has its own hash and rejects missing/corrupt state. If the
source scan was capped, omitted rows cannot be marked absent. A record's
first-seen date is not reset by a later scan. Current data remains review-only.

**These are not paid customer leads.** Every row is
`REVIEW_ONLY_UNLINKED` with `customerDeliveryAllowed: false`. There is no
automatic graph promotion, source-identity bridge, scoring, email, or
subscriber artifact. An independently verified cross-source identity and
explicit separate acceptance would be needed before customer delivery.
The `omittedByLimit` value reports records left out of the bounded private
queue rather than implying the queue is exhaustive. The workflow logs only
aggregate counts, not names, addresses, or applicant details.

## 1B. Identity hypotheses across NYC sources (not verified bridges)

The protected daily private source refresh also writes
`state/identity-bridge-review.json`. This bounded review-only receipt
finds possible relationships between:

- An existing health-department CAMIS restaurant and an unlinked DOB
  construction job or SLA licensing application at the exact same
  normalized borough and premise address.
- An unlinked DOB construction job and an unlinked SLA application at
  that same borough and premise address, before a CAMIS record exists.

Every record is checked against the full source-observation receipts and
source-row identities. The artifact supplies the official record URLs,
source fingerprints, record IDs, and reasons requiring review.
`NAME_AND_PREMISE_TO_VERIFY` indicates that the printed operator and
license-applicant DBA appear to match at one address. It is still **not**
proof of a verified identity. DOB property owners and landlords are not
assumed to be the restaurant operator.

Ambiguous buildings with more than one CAMIS identity and records
suppressed for operational conflicts are explicitly flagged. Address
co-location by itself cannot create a source identity. Overflows are
reported separately and no truncated preview claims to be exhaustive.

**No proposed match is approved automatically.** Each carries
`reviewStatus: REVIEW_REQUIRED`,
`needsIndependentVerification: true`,
`automaticIdentityLinkAllowed: false`, and
`customerDeliveryAllowed: false`. This queue is not passed to
`reviewedIdentityBridges`, the paid candidate graph, scoring, or
customer fulfillment. Independent documentary proof, explicit authorized
review, and a separately tested acceptance gate are required before any
future source-link promotion.

### Stable identity hypothesis history

The private refresh maintains `state/identity-triage-history.json` alongside
the raw source-bound hypothesis JSON, workbench HTML and CSV. The first
deployment migrates the existing identity hypothesis receipt as its baseline
and **does not** label any existing hypothesis as new. Each durable proposal
ID keeps a stable first-observed monitoring date and last-seen date.

Subsequent complete scans distinguish:
- `NEW_IDENTITY_HYPOTHESIS`: first observed by PermitPlate since baseline;
- `SOURCE_CONTEXT_RECHECK`: names, source-row fingerprints or premise
  context changed and needs another reviewer check; not a verified ownership
  or operational change;
- `ALREADY_TRACKED`: the existing unapproved relationship was seen again;
- `BASELINE_EXISTING`: present when monitoring history initialized.

The workbench sorts new and changed hypotheses first and shows first
observation dates in its HTML and CSV. Routine source-scan timestamps,
cryptographic graph receipt updates or a returning previously seen
hypothesis **do not manufacture a new relationship**. A capped source
window cannot justify declaring unseen records absent.

**Legacy receipt serialization compatibility.** The initial private
identity workbench was generated before optional source-row fingerprint
fields were normalized for JSON serialization. Its in-memory hash included
two undefined optional fields per CAMIS-to-source proposal; JSON on disk
omitted them. The original stored checksum therefore cannot be validated
by naïvely rehashing the serialized object.

The one-time migration restores **only** those known absent optional fields
in memory, validates both the original proposal fingerprints and the
original entire-receipt fingerprint, then emits a fresh, JSON-safe proof
without modifying any actual source facts, candidate IDs or first-observed
dates. A mismatched original proof fails closed. All later production
receipts must pass independent JSON round-trip verification before private
publication; this compatibility rule never authorizes identity approval.

If the private history file disappears or fails its integrity checks,
the workflow fails closed instead of resetting monitoring timestamps.
Neither monitoring novelty nor a context recheck constitutes accepted
`reviewedIdentityBridges`; explicit documentary adjudication is still
required separately.

### Private review workbench

The same protected refresh produces two additional files in the private
repository: `state/identity-bridge-review.html` and
`state/identity-bridge-review.csv`. Download the static HTML file and open it
locally to review the current source hypotheses with official links and
conflict-first evidence labels. The companion CSV contains a manual
`Human Verification Decision` column initialized to
`PENDING - NOT AN APPROVAL`, plus an empty reviewer-notes column.

The HTML contains no JavaScript, live forms, external fonts, or remote assets;
all record text is escaped. Spreadsheet fields are escaped against formulas.
CSV changes **do not** feed into automatic identity bridges or customer
delivery. A separate documented reviewer decision and governed release
acceptance are required before any identity can be promoted. All three
artifacts (the JSON receipt, CSV, and HTML) must remain private, and CI logs
may contain only aggregate counts.

## 2. Assemble a private paid subscriber review

Use an authorized workstation with the product repository and private state
checked out under `.private-state/`. Never commit the customer files or output
to the public repository.

From Stripe, read the *actual completed* Checkout Session and its matching
Subscription. Store a JSON object with `session` and `subscription` in a
private directory. Do not copy payment card details.

Initialize a private delivered-key JSON list for this subscription. Retrieve
the latest private research ledger/graph together from the same private commit.

Generate the editable, buyer-specific research queue:

```sh
node pipeline/run-curated-review-queue.js \
  --checkout .private-state/intake/checkout.json \
  --graph .private-state/state/curated-current-graph.json \
  --ledger .private-state/state/curated-research-ledger.json \
  --delivered .private-state/intake/delivered-keys.json \
  --output .private-state/intake/review-queue.json
```

This excludes out-of-territory records, records outside the subscription
baseline/optional Starter window, suppressed identities and previously
delivered events. It is **not** a list of qualified buyers: the machine does
not infer category-specific vendor need.

The review queue categorizes each source-bound opportunity as:
- `SOURCE_KEYWORD_CONTEXT`: an accepted official source contains a known
  category-related term (equipment, hood/fire, or construction-related waste).
  This **does not** prove a purchase, contract requirement, or buyer intent.
- `RELATED_OFFICIAL_ACTIVITY`: independently accepted building or licensing
  activity exists, but no specific category keyword is supported.
- `APPLICANT_CONTEXT_ONLY`: a restaurant applicant record exists, but the
  source provides no specific service-category match.

Source-keyword context sorts before general applicant context. Other
categories (POS, insurance, pest, linen, distribution) do not receive invented
automatic keyword matches; they require an explicit founder relevance review.

Each queue row includes an independent `categoryReview` structure. The
founder must verify the candidate's official records, set
`categoryReview.approved: true`, preserve the exact
`categoryReview.evidenceFingerprint`, link a bound official record in
`categoryReview.sourceUrl`, and write a specific 30–220-character
`categoryReview.rationale`. If source terms provide the apparent category
match, the cited record must be the actual matched official source; a
generic applicant page is not a substitute. An applicant-only justification
must describe relevant research context without implying an equipment order,
insurance purchase, future opening, or other unverified demand.


## 3. Founder review and artifact preparation

From the queue, delete unselected rows until at most **10** remain.
For each, open its `preview.officialUrl`, verify the business, address,
current record and actual relevance to the buyer's chosen category, and
write a supported `whyItMatters` sentence without unsupported claims.
A customer artifact is blocked if the distinct founder `categoryReview` is
missing, unapproved, stale relative to the source graph, or cites an unrelated
website. The customer report displays the category evidence basis, founder
rationale and official source link without converting a keyword into a lead.
For `eventKind: MATERIAL_CHANGE`, verify the actual previous and current
source facts using the official record and source evidence, and fill the
separate `whatChanged` field. A computed descriptor difference alone
does not establish a specific filing claim. Preserve the exact `eventId`
from the review queue; changing it invalidates the report. Material changes
receive their own subscriber-specific delivery key, so a genuine later update
can be reported without repeating a prior already-delivered item.
Set `ownerReviewed: true` on each selected review row and
`reviewedAt` to the actual review time in ISO-8601 UTC, **after the latest
graph observation**. Set the root `reviewer` and root `ownerReviewed:true`
only after completing the human review. If none credibly match, use an empty
`reviews: []` list and prepare the no-matches note.

Then generate the private HTML/CSV and exact authorized-send review plan:

```sh
node pipeline/run-curated-fulfillment.js \
  --checkout .private-state/intake/checkout.json \
  --graph .private-state/state/curated-current-graph.json \
  --ledger .private-state/state/curated-research-ledger.json \
  --reviews .private-state/intake/review-queue.json \
  --delivered .private-state/intake/delivered-keys.json \
  --output .private-state/runs/SUBSCRIPTION-AND-DATE
```

The command fails closed when the graph is stale (over 24 hours), the source
or private ledger is incomplete/tampered, Stripe is not eligible, the buyer
category/borough does not match, the owner's review is absent, or the
business/source identity changed after review. It will not overwrite
existing output. Its receipts and rendered artifacts remain private.

The status `READY_FOR_OWNER_REVIEW` or `NO_MATCHES_REVIEW` is a draft
preparation state, **not** an email-sent state.

## 4. Explicitly authorize, deliver and reconcile

Review `owner-review.json`, `message.html`, the CSV and recipient.
Use the existing `operations/DELIVERY_VERIFICATION_RUNBOOK.md` to create
a one-hour owner authorization tied to the exact recipient, attempt,
artifact and message fingerprints and signal keys. Use the approved provider,
record its real message ID and acceptance, and update the **private**
delivered-key ledger only after correct provider reconciliation.
The next product run must exclude each finalized key.

Provider acceptance is not evidence that the customer opened or even
received the email in their inbox. Never create a synthetic paid customer or
provider receipt as production proof.

## Operational limitations

- Canonical V3 scoring and the old scored-opportunity workflow remain under
  their original independent promotion gates. This lane neither replaces
  those gates nor claims to have repaired them.
- New-observation detection or a source keyword is **not** verification that a
  restaurant is genuinely new, about to open, or buying a category of goods.
  The founder validates category context and never promises vendor demand.
- Records already present on the initialization baseline do not become
  retroactive new entities. They become eligible only after a later verified
  semantic source change. The optional seven-day Starter window may include
  tracked first observations or later verified source changes, distinctly
  labeled in the customer report.
- This lane prepares real customer artifacts but does not automate actual
  email transport, payment mutation or provider reconciliation.
- All customer preference files, queue exports and research snapshots must
  stay private. Do not upload them as public CI artifacts or commit them to
  `P00NSMASHER/permitplate-nyc`.
