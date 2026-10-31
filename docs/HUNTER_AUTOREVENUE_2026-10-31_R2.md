# Autonomous Revenue Hunters | 2026-10-31 | Iteration 2

## Source and ownership
- Owner's canonical product source: `P00NSMASHER/permitplate-nyc`, `main`. This branch changes only free-trial request validation, its offline tests, and this ledger; no checkout, deploy, provider send, D1 schema or production configuration edits.
- Inspected open PRs #152 (paid checkout), #155 (evidence dates), #156 (browser request race), and #157 (server intake queue capacity). The latter two touch distinct portions of the same files; integrate/rebase after their owners approve, without overriding in-flight changes.
- Related sites: `P00NSMASHER/capturebrief` has independently owned open PRs #167-169; `P00NSMASHER/x402-product-factory` has security PR #65. Do not duplicate.

## Hunter A: evidence of existing advertised offers (NOT paid demand)
Checked public self-reported offers on 2026-10-31:
- [RestoSignals](https://restosignals.com/) advertises 100 free preview records then $29/month for scored restaurant leads. Different service and geographic scope.
- [PermitPub](https://permitpub.com/) advertises public permit/license sales feeds and $29/month after a free week. Different fulfillment cadence and record fidelity.
- [Townline](https://townline.app/) advertises permit/restaurant feed API plans beginning at $199/month, subject to quote. API product, not reviewed briefs.
- [Buildout Feed](https://buildoutfeed.com/pricing) advertises NYC restaurant pipeline intelligence at $497/month, with fuller software/contacts. Different feature depth and cadence.
These are competing **asking prices**, not independently established sales or evidence that a buyer would pay PermitPlate's current $79/month. Do not change prices based on this desk research. Narrow buyer hypothesis: NYC equipment/hood providers may value fewer, verified, source-linked records over broad unreviewed feeds. Measured willingness to pay: unavailable.

## Hunter B: buyer callback defect and source-based negative control
- Main `trial-request.js` accepted dot-atom local parts such as `buyer..contact@vendor.example.org`, `.buyer@vendor.example.org`, `buyer.@vendor.example.org`, and 65-character local parts, although those forms violate the supported unquoted SMTP mailbox syntax (RFC 5321).
- Before/after exact-source V8 check on original main blob `e90af9913f3eb6b8813fbcb25a8d09b522942be9` vs feature blob `1b857a66417d67844e1716efd3ec7c48a70dfc8d`: **4/4 unsupported addresses accepted before; 0/4 accepted after; 2/2 standard and plus-tagged examples still accepted**.
- Applied the same fail-closed check in the private Cloudflare Pages intake validator, so bypassing browser validation cannot enqueue unsupported callback addresses. Existing domain allowlist, consent, HMAC-IP controls, no-enrollment semantics and HTTPS-origin checks are unchanged.
- Added deterministic client and backend regression tests. Full native Node/Pages CI must pass before merge; **no actual customer incident or delivery bounce is asserted**.
- Rollback: revert this PR; no state or schema migration. No new dependencies, third-party code, license/NOTICE or security surface.

## Hunter C: delivery integrity and honest economics
- A receipt requires a syntactically contactable email address; validation prevents some undeliverable opt-in trial applications, but **deliverability itself cannot be guaranteed** without actual provider evidence.
- No messages sent or drafted; no paid order, Stripe transaction, source release or live deployment initiated.
- Visits, real completed requests, authorized trial admissions, paid conversions, acquisition costs and net revenue: **not inspected or independently verified**. They are unknown, not zero.
- Estimated engineering effort avoided by introducing a small validation branch versus a third-party validation dependency: 0.5-2 engineer hours, **planning estimate/low confidence**, not observed cost savings. No external library imported.
- Critical next validation: native pull-request CI including `trial-request.test.js` and `pipeline/trial-private-intake.test.js`; confirm protected merge policy and existing #156/#157 owners before release. Later examine aggregate privacy-safe trial receipts against actual provider billing only with approved access.

## Ranked next bottlenecks
1. Safely integrate outstanding intake-race and capacity PRs #156 and #157 with this validation, without bypassing CI or changing Cloudflare live settings.
2. Resolve source-readiness-backed checkout hold in #152 before a paid buyer can be charged for a non-deliverable offer.
3. Quantify consented first-party funnel from real opt-ins and provider-reconciled payments; never substitute synthetic receipts.
