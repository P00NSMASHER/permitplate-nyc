# Founder-curated fulfillment

This is the launch fulfillment contract for `FOUNDER_CURATED_NO_SCORE_V1`.
The automated scoring model remains a research system and is not part of the
paid customer promise.

## Paid offer

- $79 per month through the live Stripe Payment Link.
- One vendor category and one NYC territory selected during Checkout.
- A founder-reviewed brief each week, with up to 10 matching signals.
- The first brief is prepared within five business days of a successful payment.
- Every included signal has at least one official source link and a short,
  plain-language explanation of why it may be worth researching.
- If nothing credible matches that week, send a short no-matches note.
- Cancel at period end through Stripe. The first payment is refundable when
  requested within seven calendar days.

## First-customer checklist

1. Confirm the subscription is `active` in Stripe and matches price
   `price_1UFjcWDPW8riWrxQhnrPX6nc`.
2. Record the Checkout Session ID, Subscription ID, email, business name,
   category, territory, and Starter Snapshot choice in private operational
   state. Never store this customer information in the public repository.
3. Set the research baseline to the successful Checkout creation time. If the
   customer requested a Starter Snapshot, separately label any still-active
   record first seen during the prior seven days.
4. Review current DOHMH, SLA, DOB, and other supported official NYC records.
   Do not use a model score, rank, probability, or inferred buying intent.
5. Select no more than 10 items that match the customer profile. For every
   item, verify the business/address, stage, source-update time, official URL,
   and a concise “why it matters” note.
6. Build the brief with `pipeline/founder-curated-offer.js`. A brief fails
   closed if owner review is missing, a URL is unofficial, a score-like field
   appears, or more than 10 signals are supplied.
7. Inspect the HTML and CSV. Create an explicit, one-hour owner send
   authorization bound to the recipient, artifact fingerprint, message
   fingerprint, and exact signal keys. No authorization means no send.
8. After the email provider accepts the message, record its provider message
   ID and delivered signal keys in private state. Do not mark anything
   delivered from a local send attempt alone.
9. On the next weekly run, suppress already delivered signal keys. A materially
   changed official record may be included again only with a new key and a
   clear description of the change.

## Language boundary

Use “research signal,” “official record,” and “why it matters.” Never promise
purchase intent, opening probability, guaranteed leads, exclusivity, complete
market coverage, or a future opening date.

Support and refund requests go to `jayp19386@gmail.com`.
