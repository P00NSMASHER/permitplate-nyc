# PermitPlate NYC — Private Stripe onboarding

This is the opt-in, **read-only**, paid-customer intake for the founder-curated
`$79/month` offer. It is not a payment processor, automatic lead sender, or
scored-opportunity release.

## Trust and activation

The live workflow remains **disabled** unless the repository variable
`PERMITPLATE_STRIPE_ONBOARDING_ENABLED` is explicitly set to `true`.
The Stripe connection in a ChatGPT conversation does **not** automatically
grant GitHub Actions permission to read that account.

After reviewing Stripe's restricted-key permissions, configure a GitHub Actions
secret named `PERMITPLATE_STRIPE_READ_KEY` with a *live*, read-only restricted
key allowing **Checkout Sessions: Read** and **Subscriptions: Read** for the
PermitPlate Stripe account. Never supply an unrestricted key or paste it into
an issue, commit, workflow input or chat.

The job checks exact-current public `main` before any private credentials.
It only uses HTTPS GET against Stripe Checkout Sessions associated with
PermitPlate's exact Payment Link, followed by per-subscription readbacks.
Unknown, missing, incomplete, duplicate, mismatched or truncated provider
records fail closed. There are no Stripe writes or customer communications.

The dedicated private state repository holds:
- `state/curated-onboarding-ledger.json` — subscription ID, captured checkout
  preference fingerprint, recipient, territory, first-brief target and
  `PENDING_FOUNDER_REVIEW` / `HOLD_SUBSCRIPTION_CHANGED`.
- `state/curated-onboarding-anchor.json` — stable initial-state anchor.

The initial run may start from an empty ledger only when **both** files are
absent. If only one disappears, the process refuses to reset subscriber
history. All outputs remain private, and CI prints aggregate counters only.

## What the intake means

Stripe must confirm a `complete` Checkout Session, `paid` payment status,
an `active` Subscription, the exact PermitPlate Payment Link, the expected
price, matching customer, and complete category/territory/Starter fields.
Unpaid, trialing, expired, canceled or mismatched checkouts are **not**
treated as paid new subscribers.

For a genuine new paid checkout, the system creates one private review
obligation keyed by the Stripe subscription ID. Re-reading the same event
cannot create a second onboarding obligation. Cancellation/status changes
hold the existing record; a reactivation returns to review status without
automatically authorizing delivery.

`firstBriefTargetDate` uses five *following* Monday–Friday dates in
America/New_York. Holiday exceptions and any customer-specific commitments
need a founder review; this calculated date is a planning target rather than
an independently verified holiday-aware SLA.

## Fulfillment remains founder controlled

On new subscribers, compare the profile and target date with the live Stripe
account before reviewing the official-source graph. Then follow
`operations/CURATED_PAID_PRODUCT_RUNBOOK.md` for the private queue, supported
category relevance, human review, CSV/HTML preparation, explicit owner
authorization and provider-backed delivery reconciliation. The intake ledger
does not send, approve artifacts, change Stripe billing or mark delivery
complete.

## Verification and operating state

Use the offline regression and adversarial workflow policy tests:

```sh
node pipeline/curated-stripe-onboarding.test.js
python3 -m unittest discover -s tests -p test_stripe_onboarding_policy.py -v
```

Workflow: `.github/workflows/stripe-onboarding.yml`. A successful PR policy
run **does not** mean the live poller is enabled or that a paid customer has
been fulfilled. Activate only after a scoped live read key is configured and
the first exact-main run proves proper empty or paid state.

There were no live PermitPlate subscriptions for the exact recurring price
when independently checked on October 19, 2026. Sixteen prior checkout
sessions associated with the Payment Link were expired, not paid customers.
These live counts are a point-in-time receipt and must not be extrapolated.
