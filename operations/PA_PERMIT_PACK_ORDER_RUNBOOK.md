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

The SHA-256 ledger seal and initial anchor detect accidental modifications; they cannot independently authenticate somebody with write access. GitHub history, access controls, and independent review remain essential.

If either file is absent while its partner exists, if state is altered, if pagination is incomplete, or if an original paid Checkout disappears from a purportedly complete provider scan, the process stops without overwriting private state. Publishing uses normal non-force compare-and-swap.

## Private operator workflow — no automated send

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

    node pipeline/run-pa-permit-workbench.js research PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION PRIVATE_RESEARCH_JSON
    node pipeline/run-pa-permit-workbench.js qc PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION PRIVATE_QC_JSON

The QC JSON must use a distinct real human alias, bind the exact research fingerprint, and attest independent source, address and jurisdiction rechecks plus service limits. Self-declared IDs do NOT prove human identity or independent external validation. Even a passing QC remains NO SEND and requires real owner delivery authorization.

Create the private reviewed report:

    node pipeline/run-pa-permit-workbench.js report PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION - PRIVATE_REPORT_MD

This Markdown is a research starting point, not an official decision. It is not sent automatically.

## Delivery evidence

After an actual owner-approved manual email delivery through optional Resend, retain its true provider message ID, recipient, UTC sent time, exact research fingerprint, report SHA-256 fingerprint, and subject PA Permit Pack | Public-Source Research. The message plain-text body must match the exact reviewed Markdown report. A changed subject, recipient, body or message ID blocks independent verification. Register:

    node pipeline/run-pa-permit-workbench.js record-accepted PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION PRIVATE_RECEIPT_JSON

The case becomes PROVIDER_DELIVERY_PENDING, NOT delivered. A typed receipt is never delivery proof.

For optional independent verification, provide a separately authorized local PERMITPLATE_RESEND_READ_KEY and use:

    node pipeline/run-pa-permit-workbench.js verify-delivery PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION

The validator issues only HTTPS GET to Resend for the message and checks the recipient, message ID and delivered status. Only a real matching provider readback records DELIVERED_PROVIDER_VERIFIED. No Resend credentials, delivery sender integration, or real customer receipt have yet been verified.

## Duplicate, hold and recovery rules

- Repeated PA provider scans never create a second order for the same Checkout.
- Separate paid sessions for the same project are flagged as possible duplicate charges, never discarded.
- Research, QC and delivery progress are preserved during each recheck.
- No transport retry is automatic; a timeout requires independent provider reconciliation to avoid double sending.
- A provider-verified delivery becomes terminal; tampering or changed Checkout identity stops intake.
- Recovery plan reports stale provider checks, old paid orders, delayed provider delivery readbacks and holds, without revealing PII in logs. Run: node pipeline/run-pa-permit-workbench.js recovery-plan PRIVATE_LEDGER PRIVATE_ANCHOR
- A held case may be moved back to research only after a real operator reviews original customer support evidence and submits a private clarification/duplicate-separate-purchase attestation. Run: node pipeline/run-pa-permit-workbench.js resolve-hold PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION PRIVATE_EVIDENCE_JSON. The original paid Checkout is retained, the original fields remain immutable, and this does NOT authenticate a human or authorize customer sends.
- Recovery from destroyed/corrupted ledgers requires restoration from reviewed private Git history; no forced pushes or unverified reset.
- Scored NYC leads, original scoring holdouts and public customer pages remain unaffected.

## Deployment and acceptance

Offline:

    node pipeline/pa-permit-orders.test.js
    python -m unittest discover -s tests -p test_pa_permit_intake_policy.py -v

Activate only after tests, exact-head CI, and a successful provider-backed production read. Set PERMITPLATE_PA_ORDER_INTAKE_ENABLED=true, dispatch the PA private intake on main, require policy AND intake jobs to pass, and verify both new files in the private repository.

A green run with zero paid orders verifies operational intake, not actual paid-customer delivery or successful permit advice. Genuine paid order, real reviewed permit records, separate QC and independent provider proof are necessary for commercial acceptance.

## Provider-time and operational health safeguards (October 2026)

The read-only Resend evidence check now accepts explicit UTC-offset timestamps
and microsecond precision (the format returned by the provider). It requires
the exact originally authorized sender, one intended recipient with no extra
CC/BCC, matching message ID and subject, matching plain-text SHA-256 content,
and a plausible provider creation timestamp within ten minutes of the manual
send acknowledgement. Unexpected HTML or a changed recipient/content fails
closed. Provider `delivered`, `opened`, or `clicked` status is accepted
as provider-side transmission evidence; none proves the customer actually read
or benefited from the report.

A Checkout that was previously registered as paid but later appears unpaid in
Stripe enters `DELIVERY_RECONCILIATION_HOLD` without discarding the original
paid-order evidence. Returning to `paid` does **not** release that hold.
A refund, chargeback or dispute may leave `payment_status=paid`; separately
verify current Stripe financial evidence before fulfilling or resolving the
customer's payment.

After a successful private intake publication, the workflow now runs a
privacy-safe aggregate-only health check on its private ledger. It fails the
workflow visibly, **after retaining the private order state**, if any of these
operator-attention conditions exists: provider poll over nine hours old,
a payment-status reconciliation hold, a human hold over 24 hours old, an
undelivered case over five calendar days old, or a provider delivery receipt
unconfirmed after two hours. These durations are operational triage, not
promises of a completed report or evidence of actual customer delivery.
No messages are automatically sent, no payment is modified and no individual
customer identifiers are printed to CI logs.

Offline checks:

```sh
node pipeline/pa-permit-orders.test.js
node pipeline/pa-permit-health.test.js
```

The previously successful zero-order production runs establish provider access
and empty-state integrity, **not** a completed paid-customer delivery. The
independent commercial-delivery gate remains unmet until genuine provider
and researched-document evidence is available.
