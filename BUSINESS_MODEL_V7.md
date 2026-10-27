# PermitPlate NYC business model

Version: 9.0  
Updated: October 27, 2026

## Product promise

PermitPlate helps companies that sell to restaurants decide which NYC projects
deserve research now. The launch product is a founder-curated weekly brief built
from selected official restaurant, building, and licensing records.

PermitPlate does not sell scores, purchase intent, opening predictions,
exclusive leads, or guaranteed volume. A signal means the cited public evidence
may justify research. It does not mean the business will open, needs a vendor,
or will buy.

## Customer and scope

The self-serve membership supports one of eight vendor categories:

- POS and payments;
- insurance;
- equipment;
- hood and fire;
- waste;
- pest control;
- linen;
- distribution.

The buyer chooses all NYC, one borough, or a supported borough combination.
Multi-category, custom-market, and consulting work require a separate written
scope.

## Offer and price

- $79 per month with no setup fee.
- One vendor category and one NYC territory.
- One founder-reviewed brief each week.
- Up to 10 matching signals per brief.
- First brief within five business days after successful payment.
- A no-matches note when nothing credible qualifies.
- Optional, separately labeled seven-day Starter Snapshot.
- Cancellation at period end through Stripe.
- First payment refundable before the first send and through seven calendar
  days after the provider-confirmed first brief or no-matches note; missed or
  undeliverable first reports are handled under the published refund policy.

Keep one self-serve tier until real customer use supports different packaging.

## Bounded free trial pilot

A supervised request is available before paid membership. The operator checks
the business identity, supported category/territory and ability to deliver a
useful report. Admission is limited to 10 businesses, one trial per business.
Two reports contain up to five reviewed signals each. The 14-day period starts
at the first authorized, provider-accepted nonempty send; the next report is
eligible after seven days. Empty results do not start the clock, and current
baseline rows are not misrepresented as newly observed activity. There is no
card requirement or automatic upgrade. The existing $79 paid plan is separate.
See `operations/FREE_TRIAL_PILOT.md` for the private state and provenance rules.

## What the customer receives

Each delivered signal contains:

- business/project name and address;
- borough and relevant record stage;
- a short explanation of why the item may matter to the selected category;
- source-update and PermitPlate review times;
- at least one direct official source link; and
- a CSV row using the same signal set.

The brief contains no model score, rank, purchase-intent label, or opening
probability.

## Sources and review

NYC DOHMH is the core restaurant source. NYC DOB and New York State Liquor
Authority records may add relevant evidence. Public records may be delayed,
corrected, incomplete, duplicated, or unavailable.

The founder checks each delivered record, business/address match, stage, source
URL, and explanation. Unclear matches are omitted. The automated scoring system
remains a research system and is not part of the launch offer.

## Stripe-authoritative onboarding

Stripe Checkout is the paid membership's payment and preference authority.
Free trial preferences come from a separately approved private trial record;
they never fabricate a paid Stripe receipt. Paid Checkout collects:

1. checkout email and business name;
2. one supported vendor category;
3. one supported NYC territory; and
4. Starter Snapshot yes/no.

The completed Checkout Session ID is the preference receipt. Missing or invalid
values fail closed. Customer information and operational state never belong in
the public repository.

## Fulfillment controls

Follow `operations/FOUNDER_CURATED_FULFILLMENT.md` for the launch product. A
brief fails closed when:

- owner review is missing;
- more than 10 signals are supplied;
- a source URL is unofficial;
- a score-like field or prohibited claim appears; or
- the recipient/artifact-specific owner send authorization is missing.

Provider acceptance must reconcile to the exact send attempt before delivery
state is finalized. The next weekly run suppresses already delivered signal
keys.

## Private state

Subscriber profiles, checkout receipts, delivery history, and source ledgers
stay in the dedicated private state repository. Public code may expose only
aggregate gate states and fingerprints.

## Metrics after launch

Customer value:

- briefs opened and signals investigated;
- irrelevant or already-known items;
- corrections and false matches;
- voluntarily reported conversations and wins;
- retention, refunds, and cancellation reasons.

Operations:

- time to first brief;
- on-time weekly review rate;
- official-link and owner-review coverage;
- provider acceptance and duplicate suppression;
- no-matches rate by category and territory.

## Launch state

`READY_FOR_FIRST_PAID_CUSTOMER` means the founder-curated offer, public build,
Stripe preferences, customer portal, and no-send canary are verified. It does
not mean the business is commercially proven.

PermitPlate becomes commercially proven only after a genuine subscriber
completes provider-backed delivery and the next run verifies duplicate
suppression.
