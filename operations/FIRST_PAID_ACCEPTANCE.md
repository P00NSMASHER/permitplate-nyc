# First paid buyer: operational acceptance (not synthetic commercial proof)

Existing product: $79/month PermitPlate NYC, founder-curated no-score lane.
No payment, customer message, external outreach, or provider submission is
authorized by this document.

- **Pre-activation:** while the live Payment Link is inactive, require a fresh
  `preActivationReady: true` from the founder-curated launch controller. It
  validates the independent internal, source, checkout-field, portal, private
  Stripe monitoring and published-build gates **without accepting payment**.
  If false, fix the reported `preActivationFailures` without activating checkout.
- **Activation boundary:** a pre-activation pass is a read-only configuration
  review, not permission to change Stripe. Only a separate explicit owner
  authorization may activate the exact existing link. Immediately afterward,
  verify the live provider and require `firstCustomerOperationallyReady: true`.
  If that check fails, do not accept a buyer until the link has been placed
  back on hold through an authorized provider action.
- Configuration readiness allows considering a real subscriber. A green CI
  run is not paid customer acceptance, provider-confirmed delivery, or proof
  of next-week suppression. Do not flip commercial proof flags from simulations.
- On an actual authorized completed Stripe subscription, check exact price,
  recipient email, category, territory, baseline and Starter selection using
  the existing restricted read-only paths. Customer data stays private.
- Set a five-business-day first-send due date after completed payment. Verify
  current official records and founder rationale for at most ten signals,
  or prepare an accurate no-matches note. Source keywords are not proof of
  restaurant opening, equipment orders, or customer demand.
- Obtain separate exact owner authorization for the final reviewed message
  and provider attempt. Never treat a draft, internal success, or model score
  as delivered.
- Reconcile real provider receipt/message identity; retain actual acceptance
  and bounced status. Provider acceptance does not prove inbox receipt.
- First payment refund is available BEFORE the first send and for seven
  calendar days following provider-confirmed first send. For missed first
  deadline or undeliverable message, offer full first-payment refund/resend.
  The charge alone never starts the seven-day evaluation clock.
- Run next genuine weekly delivery against finalized private delivered-key
  ledger. Only authentic next-run suppression evidence supports promotion of
  commercial proof; no synthetic customer is evidence.
