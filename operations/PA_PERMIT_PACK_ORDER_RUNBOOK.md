# PA Permit Pack — Private order intake and fulfillment tracking

**Mode:** One-time $29 Pennsylvania public-source permit research. Private, NO SEND. Separate from the $79/month NYC subscriber and model scoring systems.

## Live payment contract

- Live one-time Stripe Payment Link: plink_1ULoeQDPW8riWrxQnDvhOlWS
- Expected price: price_1ULoeQDPW8riWrxQYrINdZAv; USD 2900, one item, no subscription.
- Required Checkout text choices: municipality (2–100), projectaddress (5–200), projectscope (5–255).
- Existing read-only Stripe secret: PERMITPLATE_STRIPE_READ_KEY.
- State repository variables and secrets: PERMITPLATE_STATE_REPO, PERMITPLATE_STATE_TOKEN.
- New opt-in variable: PERMITPLATE_PA_ORDER_INTAKE_ENABLED=true.
- Six-hour schedule: UTC 01:37, 07:37, 13:37 and 19:37.
- PRs only run offline fixtures. Only current main may read private state or live provider.

The poll GETs the real Payment Link, complete price list, all completed Checkout Sessions (bounded pagination), and separate line items for every PA paid Checkout. A session must match the exact live link, price, quantity, payment mode, currency, paid status and email. Tax may increase the total over its $29 subtotal. No payment is created or refunded.

**A paid Checkout confirms Stripe paid status, not bank settlement or non-refund.** Those require separate accounting verification.

## Private state and durability

The only scheduled write targets are state/pa-permit-orders.json and state/pa-permit-anchor.json, both in the existing private state repository. CI logs only aggregates: newly registered orders, paid statuses, held and completed counts. It never logs customer email, project address, scope, or raw provider data.

Each paid Checkout is registered once with Stripe identifiers and a payment fingerprint. Incomplete or unsafe project descriptions are still registered but held for clarification. Distinct paid Checkouts for the same customer and identical project remain separate financial obligations, with the later order held for duplicate review. No silent deletion, merger, automatic refund or automatic email is allowed.

The SHA-256 ledger seal and initial anchor detect accidental modifications; they cannot independently authenticate somebody with write access. GitHub history, access controls, actual customer-evidence examination, separate report QC and independent provider/payment readback remain essential. **An independent source-code or PR reviewer is not required** under [the owner-authorized code release policy](CODE_RELEASE_POLICY.md); changing code approval does not authenticate an operator or release customer data.

If either file is absent while its partner exists, if state is altered, if pagination is incomplete, or if an original paid Checkout disappears from a purportedly complete provider scan, the process stops without overwriting private state. Publishing uses normal non-force compare-and-swap.

## Private operator workflow — no automated send

The direct workbench CLI is **read-only or draft-only**. Its mutating commands
are intentionally disabled to prevent a local JSON edit from bypassing the
guarded private Git synchronization. For every genuine research, QC,
hold-resolution, send-receipt or delivery-verification transition, use the
transaction command documented below and supply the current private ledger
fingerprint. Refresh it before **each** mutation because an intervening
scheduled Stripe poll changes the private state revision.

Work on a fresh private state-repository checkout. Use the workbench from the PermitPlate code repo, substituting **private absolute paths**:

    node pipeline/run-pa-permit-workbench.js status PRIVATE_LEDGER PRIVATE_ANCHOR
    node pipeline/run-pa-permit-workbench.js draft PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION - PRIVATE_DRAFT_JSON

The draft is not evidence. It includes real customer details and must never go into public GitHub, chat, or public Actions artifacts. Research must be performed on the applicable actual original official sources. Fill a private research JSON with:

- A real researcher alias and preparation timestamp.
- Actual project interpretation, jurisdiction, authority and fee limits.
- At least two separate cited sources with IDs, URLs, timestamps and specific facts. At least one must be a government source.
- Two applicable actions supported by those sources and at least one unresolved issue.
- No guarantee of permit approval, project applicability, legal advice, or government endorsement.

Register genuine research, then review it separately:

    node pipeline/pa-permit-case-transaction.js research PRIVATE_STATE_ROOT cs_LIVE_SESSION PRIVATE_RESEARCH_JSON EXPECTED_CURRENT_LEDGER_FINGERPRINT
    node pipeline/pa-permit-case-transaction.js qc PRIVATE_STATE_ROOT cs_LIVE_SESSION PRIVATE_QC_JSON EXPECTED_CURRENT_LEDGER_FINGERPRINT

The QC JSON must use a distinct real human alias, bind the exact research fingerprint, and attest independent source, address and jurisdiction rechecks plus service limits. Self-declared IDs do NOT prove human identity or independent external validation. Even a passing QC remains NO SEND and requires real owner delivery authorization.

Create the private reviewed report:

    node pipeline/pa-permit-case-transaction.js report PRIVATE_STATE_ROOT cs_LIVE_SESSION PRIVATE_REPORT_MD EXPECTED_CURRENT_LEDGER_FINGERPRINT

Financial proof is now mandatory before a delivery-ready report is rendered.
Do not use the old direct workbench report command. The guarded transaction
requires clean, exact-current main checkouts of the public source and separate
private state repositories, a matching untouched private anchor, and a current
ledger fingerprint. The output must be a NEW file outside BOTH Git repositories.
No private customer details or report body are written to public CI.

Separately create a LIVE Stripe restricted read-only key named
PermitPlate-PA-FinancialReview, with Payment Intents: Read and Charges: Read
permissions only. All other permissions must be None. Supply this key as
the local environment variable PERMITPLATE_PA_FINANCIAL_READ_KEY. Do not paste
it into chat, commit it, or store it in public Actions. The existing recurring
six-hour Checkout monitor still uses its existing narrowly scoped key.

At report time the guarded transaction performs exactly two authenticated
GETs: the immutable original Payment Intent, then its latest Charge. Both
must match the original customer, amount, USD currency and successful
paid/captured status, with no refund, refunded amount or dispute. An absent
credential, forbidden provider read, inconsistent identity, or changed payment
results in a financial hold and NO REPORT output. This is a point-in-time
risk check, not proof of settlement or freedom from future chargebacks.
A fresh financial check is needed immediately before any manual send.

The reviewed Markdown is a research starting point, not an official decision.
It is not sent automatically, and the financial readback does not authorize
delivery by itself.

## Delivery evidence

After an actual owner-approved manual email delivery through optional Resend, retain its true provider message ID, recipient, **exact approved From sender**, UTC sent time, exact research fingerprint, report SHA-256 fingerprint, and subject PA Permit Pack | Public-Source Research. The private receipt must now include expectedSender matching the actual Resend From value (either a verified email or a named sender such as PermitPlate Research <research@example.org>). The message plain-text body must match the exact reviewed Markdown report. A changed sender, subject, recipient, body or message ID blocks independent verification. Register:

    node pipeline/pa-permit-case-transaction.js record-accepted PRIVATE_STATE_ROOT cs_LIVE_SESSION PRIVATE_RECEIPT_JSON EXPECTED_CURRENT_LEDGER_FINGERPRINT

The case becomes PROVIDER_DELIVERY_PENDING, NOT delivered. A typed receipt is never delivery proof.

For optional independent verification, provide a separately authorized local PERMITPLATE_RESEND_READ_KEY and use:

    node pipeline/pa-permit-case-transaction.js verify-delivery PRIVATE_STATE_ROOT cs_LIVE_SESSION - EXPECTED_CURRENT_LEDGER_FINGERPRINT

The validator issues only HTTPS GET to Resend for the message and checks the exact one-recipient delivery, approved sender, message ID, subject and SHA-256 of the original reviewed plain-text report. The documented created_at date may contain an explicit timezone offset and microseconds; the readback accepts those formats with a ten-minute send-time correlation window. Last events delivered, opened and clicked constitute provider delivery-status evidence, **not** evidence that a real human read or acted on the report. Bounces, complaints, unexpected HTML versions, CC/BCC recipients, forged/mismatched timestamps, sender mismatches and changed contents fail closed. A separate Resend credential and genuine provider receipt remain unverified for real customers.

## Duplicate, hold and recovery rules

- Repeated PA provider scans never create a second order for the same Checkout.
- Separate paid sessions for the same project are flagged as possible duplicate charges, never discarded.
- A customer-confirmed separate purchase does **not** validate project details. Before releasing any duplicate hold, independently review the effective original or customer-corrected municipality, address and scope. An invalid original or malformed override remains held; do not set `projectValid=true` by attestation alone.
- Manual project corrections must satisfy the same text limits, canonicalization, jurisdiction ambiguity checks, and no-markup/no-URL rules as original paid Checkout input. Private ledger readback rechecks corrected projects even if its SHA-256 seal was recomputed. This text verification is **not** boundary geocoding or verified permit authority.
- A hold-release review timestamp must be a valid UTC instant between the actual paid order time and the current operation time. Future-dated self-attestations remain on hold.
- Research, QC and delivery progress are preserved during each recheck.
- No transport retry is automatic; a timeout requires independent provider reconciliation to avoid double sending.
- A provider-verified delivery becomes terminal for sending; tampering or changed Checkout identity stops intake.
- If a previously paid Checkout later reports unpaid, the original order enters a financial reconciliation hold. A subsequent paid readback does **not** silently release the hold. Verify the payment and correct state manually before any additional fulfillment.
- Stripe Checkout paid status alone does **not** prove the transaction was never refunded, disputed or charged back. Before manually sending, the operator must check current Stripe payment/charge details using separately authorized financial read access; the restricted checkout credential alone is insufficient.
- Recovery plan reports stale provider checks, old paid orders, delayed provider delivery readbacks and holds, without revealing PII in logs. Run: node pipeline/run-pa-permit-workbench.js recovery-plan PRIVATE_LEDGER PRIVATE_ANCHOR
- A held case may be moved back to research only after a real operator reviews original customer support evidence and submits a private clarification/duplicate-separate-purchase attestation. Run: node pipeline/pa-permit-case-transaction.js resolve-hold PRIVATE_STATE_ROOT cs_LIVE_SESSION PRIVATE_EVIDENCE_JSON EXPECTED_CURRENT_LEDGER_FINGERPRINT. The original paid Checkout is retained, the original fields remain immutable, and this does NOT authenticate a human or authorize customer sends.
- Recovery from destroyed/corrupted ledgers requires restoration from reviewed private Git history; no forced pushes or unverified reset.
- Scored NYC leads, original scoring holdouts and public customer pages remain unaffected.

## Deployment and acceptance

Offline:

    node pipeline/pa-permit-orders.test.js
    python -m unittest discover -s tests -p test_pa_permit_intake_policy.py -v

Activate only after tests, exact-head CI, and a successful provider-backed production read. Set PERMITPLATE_PA_ORDER_INTAKE_ENABLED=true, dispatch the PA private intake on main, require policy AND intake jobs to pass, and verify both new files in the private repository.

After a successful private state commit/push, the scheduled PA intake runs **read-only, aggregate-only health monitoring**. It detects paid-status reversal holds, human holds older than 24 hours, unverified provider delivery receipts older than two hours, unfulfilled orders older than five calendar days, and stale provider checks. If a meaningful incident exists, GitHub Actions finishes red **after retaining the paid order in private state**. This surfaces issues without sending messages or exposing customer IDs, emails or addresses. Those time thresholds are internal operational triage, not customer delivery guarantees.

Offline monitoring regression: node pipeline/pa-permit-health.test.js.

A green run with zero paid orders verifies operational intake, not actual paid-customer delivery or successful permit advice. The financial proof regression (node pipeline/pa-permit-financial-readback.test.js) uses a disposable synthetic private Git repository and fake Stripe responses. It does not prove a real paid customer or a production financial key is configured. Genuine paid order, real reviewed permit records, separate QC and independent provider proof are necessary for commercial acceptance.

## Durable, guarded publication of human-approved case updates

A local change to a private JSON file is **not** yet a durable production
update. The scheduled Stripe poll writes to the same private main branch.
Never hand-edit and force-push the ledger: doing so can erase new paid orders
or lose a verified delivery.

For a *real* operator working with *real independently reviewed evidence*,
use the guarded private transaction command. It accepts five private ledger
mutation operations (research, qc, resolve-hold, record-accepted, and
verify-delivery), plus one read-only guarded report operation. The report
operation verifies the current payment and private order state before creating
a new private artifact. No operation automatically sends customer mail, refunds
a Stripe payment, creates a customer or releases scored leads.

First, use a **clean, current main** checkout of both source repo
`P00NSMASHER/permitplate-nyc` and private repo
`P00NSMASHER/permitplate-state`. The private checkout must be a standalone
Git repository with its own exact `origin/main`, not a copied folder.
View the complete current `ledgerFingerprint` inside the private
`state/pa-permit-orders.json` using trusted local tooling. Prepare the
genuine evidence JSON outside the public repository.

Run this from the clean public source repo, with the private state-root,
paid Checkout Session ID, evidence path and expected *full* ledger SHA-256:

```sh
node pipeline/pa-permit-case-transaction.js \
  research \
  /private/permitplate-state \
  cs_LIVE_SESSION_ID \
  /private/reviewed-research.json \
  EXPECTED_CURRENT_LEDGER_FINGERPRINT
```

Use the other supported mode names for a different authorized transition.
For `verify-delivery`, supply `-` instead of an evidence-packet path and
provide a separately scoped local `PERMITPLATE_RESEND_READ_KEY` variable;
the module performs only a Resend provider **GET**, never a send. The
command generates its UTC transaction time itself.

The transaction fails closed unless both source and private checkouts are
clean, use `main`, point to their **exact approved** GitHub repositories,
and their local HEAD equals the remote main commit. It additionally requires
a complete matching private anchor and current ledger-fingerprint match, one
known paid case and the expected allowed transition. A local lock prevents
concurrent owner edits. The post-review check confirms that the only changed
file is the PA order ledger, that original payment identity and every other
paid order were preserved, and that the anchor has not changed.

Only then does the command commit **one private ledger file** and attempt a
normal **non-force push**. If a scheduled Stripe poll or another owner update
moves the remote in between, that push is rejected. The operator must
refresh, re-review the changed state and reconcile the private branch rather
than force-pushing or overwriting main. A process interruption can leave a
local `.git/permitplate-pa-operator.lock`; do not remove a lock until its
owner process is definitively stopped. A stale local commit is not evidence
that production was updated.

The module's CLI response includes only the private commit ID and aggregate
no-send status. It never prints customer names, addresses, recipient email,
project scope or raw provider responses. Because a case is independently
reviewed by humans, a green offline fixture or a recorded alias never counts
as authenticated real customer evidence.

Regression:

```sh
node pipeline/pa-permit-case-transaction.test.js
```

This uses a disposable local bare Git remote and entirely synthetic paid
Checkouts to verify normal publication, idempotent replay, stale-checkout
refusal, dirty-worktree refusal, trusted remote checks, expected revision
binding, local concurrency lock and immutable paid-order identity. It does
not contact any customer or private production state.


## Independent PA order intake watchdog — missing-run detection

The normal PA intake is scheduled four times daily. Its own health check executes **after** the provider scan, so a disabled GitHub schedule, missed run, or sustained checkout-token failure might otherwise go unnoticed.

The separate **PermitPlate PA independent order watchdog** reads only the already-retained PRIVATE ledger and anchor, without any Stripe API credential, financial account access, Git writes, provider POST, customer contact, or sending. It runs at 02:17, 05:17, 08:17, 11:17, 14:17, 17:17, 20:17 and 23:17 UTC, forty minutes after alternating scheduled intake runs. GitHub Actions scheduling can itself be delayed; this is independent in workflow design but not an external uptime service.

Before opening private state it confirms exact current public main and the configured private repository, uses immutable pinned workflow dependencies and the existing private-state token, then rechecks the public source commit. Its concurrency group matches the PA private-state writers so a legitimate in-flight update is not mistaken for stale state.

The watchdog reports only aggregate counts by phase and the number of newly registered paid orders in the preceding 24 hours. It fails its scheduled GitHub Actions run if:

- Automatic PA monitoring has been disabled while the watchdog remains active.
- Either private state file is missing, malformed or mismatched to its original anchor.
- The current clock predates the last verified provider read.
- The last Stripe-backed private intake observation is more than nine hours old.
- An existing paid order needs financial reconciliation, has an unresolved operator hold exceeding 24 hours, has not been delivered in over five calendar days, or has been waiting more than two hours for provider delivery evidence.

A red watchdog requires operator review of the private order ledger and the failed run. No automated retry, refund, customer email or scored lead follows. A green watchdog and zero orders demonstrate provider-monitoring continuity only, not real fulfillment. GitHub failure notifications depend on the account's repository notification settings, and GitHub-wide outages cannot be detected by another GitHub workflow.

The public/PR jobs run only offline synthetic fixtures and security policy tests:

    node pipeline/pa-permit-watchdog.test.js
    python3 -m unittest discover -s tests -p 'test_pa_permit_watchdog_policy.py' -v

The independently scheduled watchdog is read-only and intentionally uses no additional API key, paid monitoring vendor, or external customer transport.

## County and municipality text guard (bounded reference set)

The intake validator additionally compares the customer-supplied municipality
text to 32 distinct, sanitized official Pennsylvania DLI municipal-election
reference rows from two previously reviewed public source packs. It conservatively
holds a project for operator clarification if a known municipality name is
paired with an unmatched county, a mismatched borough/township/city type, an
ambiguous same-name municipality type, or no explicit county. The paid
Checkout is still privately registered as a financial obligation even when
the project enters HOLD_PROJECT_DETAILS.

A matching record is **only a municipal text-reference match**. It does not
geocode the property to municipality boundaries, establish a current enforcing
agency/official or prove permit applicability. A municipality not included in
these 32 selected rows is NOT automatically invalidated: the same genuinely
independent human official-source and boundary verification remains mandatory
during research and QC. This is **not** a statewide 2,562-municipality census.
No contact names or phone numbers from the government source enter the public
repository or commercial evidence.

Regression:
`node pipeline/pa-jurisdiction-identity.test.js`

### Owner triage alert on a newly registered payment

The existing independent, read-only PA watchdog now treats any privately
registered paid Checkout that is still in `RESEARCH_QUEUE`,
`HOLD_PROJECT_DETAILS` or `HOLD_POSSIBLE_DUPLICATE` as an
`PA_PAID_ORDER_AWAITING_FIRST_HUMAN_REVIEW` operational incident. It reports
only the **count**, never session IDs, names, locations or customer emails.
The watchdog remains red until an authorized operator actually advances the
order into researched review (or another independently justified state). This
alert does **not** authorize delivery, refund or duplicate-charge resolution.

The current watchdog cadence is roughly every three hours, subject to GitHub
Actions scheduling delays. A failed workflow is a machine-readable incident;
whether a human receives a notification depends on GitHub notification
settings. Do not promise instant customer support or a real-time alert.
The six-hour read-only payment intake itself remains unchanged. A synthetic
fixture cannot stand in for a real paying customer.
