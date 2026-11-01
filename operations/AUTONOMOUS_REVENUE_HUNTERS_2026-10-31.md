# Hunter Network · Autonomous Revenue · 2026-10-31 checkpoint

## Concrete observed bottleneck and scope
- Canonical repository: [P00NSMASHER/permitplate-nyc](https://github.com/P00NSMASHER/permitplate-nyc) on `main`, following merged [#150](https://github.com/P00NSMASHER/permitplate-nyc/pull/150) and [#151](https://github.com/P00NSMASHER/permitplate-nyc/pull/151). No open PRs existed at inspection.
- Exact source before this proposal: `start.html` contained one direct, publicly reachable hosted $79 subscription checkout link. The homepage routed to it and tests incorrectly **required** the direct link. [Issue #16](https://github.com/P00NSMASHER/permitplate-nyc/issues/16) documents a Stripe link with unverified preference capture and subscriber-fulfillment readiness.
- Proposed fix only: clearly mark the paid plan on hold in source, send new visitors into the already built supervised no-card trial, remove the direct $79 checkout href, and enforce the negative contract in unit/build tests.
- This does **not** deactivate a bookmarked/reusable Stripe link, verify Stripe customer custom fields, activate the private subscriber poll, prove first delivery, change a price or term, or publish/deploy any site. No live buyer is represented as having used this hold page.

## Buyer/demand triangulation: public advertised pricing, not paid validation
1. [ContractsIntel](https://contractsintel.com/): advertises Discovery at $99/month or $79.20/month annually and BD Pro at $239.20/month annually; free trial without card.
2. [DeBerry Federal](https://deberryfederal.com/pricing): advertises federal-contracting Pro at $149.95/month and Enterprise at $499/month.
3. [BidSmith](https://www.bidsmith.pro/): advertises $999/month for RFP compliance-audit services; customer claims and model accuracy not independently established.
4. [PermitExpertsNYC](https://permitexpertsnyc.com/pricing/): advertises $500–$5,000+ for NYC manual permit expediting, an adjacent service, **not** a valid apples-to-apples subscription comparison.

The CaptureBrief market appears to have published prices for source-based government procurement triage. The PermitPlate vendor-sales category has potential buyer urgency but no observed willingness-to-pay proof in these sources. **Hypotheses only**, not customer demand validated by revenue.

## Measurement ledger and confidence
- Baseline exact $79 checkout links in public `start.html`: 1.
- After this proposed source change: 0. Public source HTML paths exposing the exact link: 1 -> 0, conditional on PR passing tests and any authorized deployment.
- Historical/live paid sales, revenue, profit, subscriptions, trial requests, visitors, conversion denominator and customer acquisition cost: **not verified/unknown**. Two connected Stripe account reads requested interactive authorization, so no live financial assertion is made.
- This branch changes no payments, email, hosting, credentials, state stores, or customer data. No customers contacted.
- The saved external Payment Link **may still accept payment** after the website changes. Do not describe this PR as a fully secure checkout-disable mechanism.

## Highest-priority next steps
1. Obtain explicit owner authorization for any Stripe live change, then deactivate the reusable link or require provider-verified category/territory/Starter fields and bound subscriber session receipts before accepting payment. Inspect link and completed sessions read-only first.
2. Confirm private opt-in subscriber poll, launch-source freshness, provider-backed customer-profile activation, NO_SEND acceptance, refunds/cancellation and first verified delivery before re-opening a payable link.
3. After owner approves a public sales-surface change and PR CI passes, verify both Cloudflare and GitHub Pages deployment identity. A source PR alone is not a public fix.
4. Conduct a genuinely opt-in buyer test (vendor category and NYC territory) and record actual requests / qualified inquiries / authorized payments with exact dates. Unknown denominators remain unknown.

## Hunter rotation and dedupe
- A: external, source-linked competitor pricing and precise buyer problem ranking.
- B: small safety-and-conversion UX change with executable regression tests, not a separate demo.
- C: documented exact provider gate and rollback path without creating a duplicate checkout/backend.
- Next run should inspect this PR and owners before overlapping work. No automation or production change here.
