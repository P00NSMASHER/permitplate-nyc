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

After an actual owner-approved manual email delivery through optional Resend, retain its true provider message ID, recipient, **exact approved From sender**, UTC sent time, exact research fingerprint, report SHA-256 fingerprint, and subject PA Permit Pack | Public-Source Research. The private receipt must now include expectedSender matching the actual Resend From value (either a verified email or a named sender such as PermitPlate Research <research@example.org>). The message plain-text body must match the exact reviewed Markdown report. A changed sender, subject, recipient, body or message ID blocks independent verification. Register:

    node pipeline/run-pa-permit-workbench.js record-accepted PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION PRIVATE_RECEIPT_JSON

The case becomes PROVIDER_DELIVERY_PENDING, NOT delivered. A typed receipt is never delivery proof.

For optional independent verification, provide a separately authorized local PERMITPLATE_RESEND_READ_KEY and use:

    node pipeline/run-pa-permit-workbench.js verify-delivery PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION

The validator issues only HTTPS GET to Resend for the message and checks the exact one-recipient delivery, approved sender, message ID, subject and SHA-256 of the original reviewed plain-text report. The documented created_at date may contain an explicit timezone offset and microseconds; the readback accepts those formats with a ten-minute send-time correlation window. Last events delivered, opened and clicked constitute provider delivery-status evidence, **not** evidence that a real human read or acted on the report. Bounces, complaints, unexpected HTML versions, CC/BCC recipients, forged/mismatched timestamps, sender mismatches and changed contents fail closed. A separate Resend credential and genuine provider receipt remain unverified for real customers.

## Duplicate, hold and recovery rules

- Repeated PA provider scans never create a second order for the same Checkout.
- Separate paid sessions for the same project are flagged as possible duplicate charges, never discarded.
- Research, QC and delivery progress are preserved during each recheck.
- No transport retry is automatic; a timeout requires independent provider reconciliation to avoid double sending.
- A provider-verified delivery becomes terminal for sending; tampering or changed Checkout identity stops intake.
- If a previously paid Checkout later reports unpaid, the original order enters a financial reconciliation hold. A subsequent paid readback does **not** silently release the hold. Verify the payment and correct state manually before any additional fulfillment.
- Stripe Checkout paid status alone does **not** prove the transaction was never refunded, disputed or charged back. Before manually sending, the operator must check current Stripe payment/charge details using separately authorized financial read access; the restricted checkout credential alone is insufficient.
- Recovery plan reports stale provider checks, old paid orders, delayed provider delivery readbacks and holds, without revealing PII in logs. Run: node pipeline/run-pa-permit-workbench.js recovery-plan PRIVATE_LEDGER PRIVATE_ANCHOR
- A held case may be moved back to research only after a real operator reviews original customer support evidence and submits a private clarification/duplicate-separate-purchase attestation. Run: node pipeline/run-pa-permit-workbench.js resolve-hold PRIVATE_LEDGER PRIVATE_ANCHOR cs_LIVE_SESSION PRIVATE_EVIDENCE_JSON. The original paid Checkout is retained, the original fields remain immutable, and this does NOT authenticate a human or authorize customer sends.
- Recovery from destroyed/corrupted ledgers requires restoration from reviewed private Git history; no forced pushes or unverified reset.
- Scored NYC leads, original scoring holdouts and public customer pages remain unaffected.

## Deployment and acceptance

Offline:

    node pipeline/pa-permit-orders.test.js
    python -m unittest discover -s tests -p test_pa_permit_intake_policy.py -v

Activate only after tests, exact-head CI, and a successful provider-backed production read. Set PERMITPLATE_PA_ORDER_INTAKE_ENABLED=true, dispatch the PA private intake on main, require policy AND intake jobs to pass, and verify both new files in the private repository.

After a successful private state commit/push, the scheduled PA intake runs **read-only, aggregate-only health monitoring**. It detects paid-status reversal holds, human holds older than 24 hours, unverified provider delivery receipts older than two hours, unfulfilled orders older than five calendar days, and stale provider checks. If a meaningful incident exists, GitHub Actions finishes red **after retaining the paid order in private state**. This surfaces issues without sending messages or exposing customer IDs, emails or addresses. Those time thresholds are internal operational triage, not customer delivery guarantees.

Offline monitoring regression: node pipeline/pa-permit-health.test.js.

A green run with zero paid orders verifies operational intake, not actual paid-customer delivery or successful permit advice. Genuine paid order, real reviewed permit records, separate QC and independent provider proof are necessary for commercial acceptance.
