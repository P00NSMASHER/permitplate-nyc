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

- `state/curated-research-ledger.json` — the stable first-observed timestamp
  per CAMIS, including entities now outside the current source window.
- `state/curated-current-graph.json` — the current graph and official-source
  observation receipts. No customer data or scored opportunity packages.
- `state/curated-baseline-anchor.json` — the immutable initialization anchor
  that prevents accidentally resetting one missing ledger file.

The first valid scan creates a baseline with **zero new signals**. Subsequent
complete scans can identify newly observed CAMIS identities, with suppressed
or identity-conflicted candidates held for review. A changing source
`record_date`, returning candidate, incomplete source, or failure of the
current graph can never manufacture a new opportunity.

The research snapshot and ledger are committed together in the private
repository. Main-only runtime and no-force push protect against concurrent
writes. A failed scored-opportunity package does **not** block this independent
research history and does not change the scored ledger.

The workflow never contacts customers, publishes paid candidate state to
public GitHub, or exercises a payment API.

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

## 3. Founder review and artifact preparation

From the queue, delete unselected rows until at most **10** remain.
For each, open its `preview.officialUrl`, verify the business, address,
current record and actual relevance to the buyer's chosen category, and
write a supported `whyItMatters` sentence without unsupported claims.
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
- New-observation detection is **not** verification that a restaurant is
  genuinely new, about to open, or buying a category of goods. A human
  validates the research value.
- Records already present on the initialization baseline do not become
  retroactive subscriber events. The only pre-subscription allowance is
  the explicit seven-day Starter window of *tracked first observations*.
- This lane prepares real customer artifacts but does not automate actual
  email transport, payment mutation or provider reconciliation.
- All customer preference files, queue exports and research snapshots must
  stay private. Do not upload them as public CI artifacts or commit them to
  `P00NSMASHER/permitplate-nyc`.
