# PermitPlate supervised free trial

Updated October 27, 2026. This is a bounded, no-card pilot workflow, not an
unattended signup or mail service. The website creates a local email draft;
the customer reviews and sends it. No intake is silently submitted.

## Offer

- One trial per business, one vendor category and NYC territory.
- Cohort limit: 10 businesses, including previously expired/cancelled trials.
- Two reports: a starter brief and one weekly update, at most five signals each.
- Fourteen days from the first nonempty report's authorized, provider-confirmed
  accepted send. Provider acceptance is not proof of inbox delivery.
- The second report is eligible after seven days and before expiry.
- No card, Stripe subscription, automatic charge or automatic paid upgrade.
- The established $79/month paid membership requires separate customer checkout.

No-matches results and initial monitoring baseline rows do not start a trial.
The existing source ledger must already contain genuine observations after its
initialization. An empty or source-unavailable result is not a free report.
If scope cannot be served, explain that before admission; never invent activity
to fulfill the offer. Only the actual owner may approve customer source review
or authorize sending a report. Software tests use explicitly synthetic owners.

## Admission and private state

Use one canonical registry at `state/nyc-free-trials.json` in the dedicated
private `P00NSMASHER/permitplate-state` checkout. Do not commit it to this public
repository or publish it as an Actions artifact. Keep its history alongside it.

The operator confirms the business name and canonical public business domain,
including aliases and parent companies, before approval. Name/domain matching
blocks ordinary repeat requests; it is not automatic identity authentication.
One company using multiple domains must retain one canonical identity. All
territory and category values must come from the supported paid-offer contract.

Before admission, confirm that the available reviewed records support a useful
rationale for this customer's actual vendor category and territory. General
restaurant activity alone is not enough to promise a useful category match.
If that rationale cannot be supported, hold the request or return no matches;
keep the trial clock dormant until a genuinely useful report is available.
Do not fill a report to start the clock. A useful rationale need not contain an
exact category keyword, but it must explain the documented relevance and its
limits without inventing buying intent, an open order or an opening date.

Initialize a TEST registry for QA. LIVE admission is a separate operator action:

```sh
node pipeline/run-free-trial.js --action init --environment TEST --output /private/nyc-free-trials.json
```

An admission file contains the following shape (illustrative values only):

```json
{
  "request": {
    "businessName": "Example Vendor",
    "businessDomain": "vendor.example.com",
    "recipientEmail": "buyer@example.com",
    "category": "equipment",
    "territory": "Brooklyn",
    "requestedAt": "2026-10-27T08:00:00.000Z"
  },
  "approval": {
    "ownerApproved": true,
    "reference": "ACTUAL_OWNER_SCOPE_APPROVAL_REFERENCE",
    "approvedAt": "2026-10-27T09:00:00.000Z"
  }
}
```

Do not copy the illustrative approval into a live record. Each mutation uses
the current registry fingerprint, an exclusive lock, an immutable history file
and atomic replacement of the same canonical file. It rejects a stale expected
fingerprint or a fork to a different output file. The initial implementation
is for one operator and one authoritative private checkout; remote/private
repository synchronization remains an operator responsibility before and after
the transaction. Never operate simultaneously on separate offline copies.

```sh
node pipeline/run-free-trial.js --action enroll --registry /private/nyc-free-trials.json --expected-fingerprint CURRENT_FINGERPRINT --input /private/admission.json
```

## Source-bound report preparation

The preparation bundle contains `graph`, `ledger`, `reviews`, `reviewer` and
`ownerReviewed`, exactly as the paid curated workflow. It never contains a fake
Stripe Checkout Session. `prepareTrial()` derives the recipient, category,
territory, baseline and delivered-key history from the registry, not review input.

The existing graph fingerprint, complete official-source counts, 24-hour source
age, genuine observed-event history, business/address identity, supported
borough, category-source review, founder review and duplicate-suppression checks
remain in place. Trial input is capped at five reviews. Initial baseline rows
remain excluded; source extraction dates are not new application/opening dates.

```sh
node pipeline/run-free-trial.js --action prepare --registry /private/nyc-free-trials.json --trial-id TRIAL_ID --input /private/reviewed-source-bundle.json --output /private/new-report-directory
```

The new output directory receives `prepared.json`, `message.html` and the CSV.
Public paths, public-path symlink redirects, existing files and nonempty output
directories are rejected. Preparation does not send, start the clock, or count
as customer value. Inspect the actual files before requesting send authorization.

## Provider reconciliation and trial clock

The existing recipient/artifact/message/attempt-specific owner authorization
must be valid at the actual transport time. Sending itself is outside this CLI.
The operator imports the authenticated provider readback, then records it:

```sh
node pipeline/run-free-trial.js --action record-delivery --registry /private/nyc-free-trials.json --expected-fingerprint CURRENT_FINGERPRINT --trial-id TRIAL_ID --input /private/provider-reconciliation.json
```

That file contains `prepared` (the original preparation receipt), `evidence`
(the existing `delivery-state-evidence` contract: provider observation, transport
authorization, transport start and reconciliation timestamps), and `attestation`.
LIVE attestation requires `operatorVerified: true`,
`kind: "AUTHENTICATED_PROVIDER_READBACK"`, and a private verification reference.
TEST registries instead require `kind: "TEST_FIXTURE"`. TEST evidence cannot
activate a LIVE trial. The CLI does not authenticate an arbitrary JSON file;
the operator must actually obtain and inspect the provider record through the
authenticated adapter. A self-written assertion is not provider proof.

Actual report HTML, CSV, subject, signal keys, preparation receipt and provider
bindings are checked. Source age is checked again at transport/acceptance;
an old prepared packet cannot start a new trial. Wrong recipient, altered
content, missing authorization, future/invalid times and no-match packets fail
closed. Successful retries are idempotent only after the provider evidence is
revalidated. A later bounced record puts the trial on DELIVERY_HOLD; it never
silently consumes the free period. The owner resolves the delivery issue before
any replacement offer. Do not relabel provider acceptance as confirmed inbox
delivery.

Cancellation uses the same canonical transaction:

```sh
node pipeline/run-free-trial.js --action cancel --registry /private/nyc-free-trials.json --expected-fingerprint CURRENT_FINGERPRINT --trial-id TRIAL_ID
```

## Pilot measurements and release boundary

Privately record source-review/fulfillment minutes, report count, source
corrections, the customer's usefulness/relevance feedback, and explicit paid
conversion or decline. Payment is proved by real Stripe records; trial requests
and fixture sends are not revenue. On paid conversion, reconcile the new paid
profile and prior trial reports so already-seen starter context is not presented
as a newly discovered lead. The free-trial code does not mutate paid billing.

Current evidence proves source processing, exact official readback and tested
no-send lifecycle controls. It does not establish live customer delivery,
customer value, conversion, opening predictions or buyer intent. Keep admission
supervised until those operational results have actually been recorded.

## Explicit customer simulations

Run the offline exercise with a saved current public graph and a new private
output directory:

```sh
node pipeline/trial-customer-simulation.js /private/current-source-graph.json /private/new-test-simulation
```

It uses the actual trial renderer and reconciler for synthetic equipment and
POS vendors, each with a starter and weekly report, a fictional observation
timeline and TEST provider receipts. Genuine public restaurant fields can be
copied unchanged from the input graph; that does not make the simulated
monitoring events, owner judgments or customer opinions genuine.

The HTML and subject visibly say TEST SIMULATION; every simulated CSV rationale
is labeled TEST. Both reports show the free terms and separate optional $79
membership. The output includes readable first/weekly HTML and CSV, synthetic
persona assessments of source fidelity, territory, category relevance,
uncertainty, next steps and upgrade terms, plus lifecycle results. Weak generic
context may correctly produce a simulated decision to defer or decline.

Explicit TEST/simulation review or source markers, including synthetic reviewer
labels, are rejected before LIVE trial preparation and again at delivery
recording. TEST records cannot supply authentic owner/provider approval. This
exercise makes no provider calls, sends no messages, creates no billing, changes
no real customer or private production state, and creates no commercial proof,
independent human review or scoring-calibration labels.
