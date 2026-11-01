# Autonomous Revenue Hunters | 2026-10-31 | Run 6: atomic pilot-intake capacity

## Reproducible baseline and branch provenance
- Canonical repository: `P00NSMASHER/permitplate-nyc`; isolated branch `hunter/revenue-trial-atomic-queue-20261031-r6` from `main` at `7cc9b1dd98e3ac00d00d4bcef856993237277751`.
- Open PR ownership checked: #152 owns paid checkout, #155 owns public-evidence date rules, #156 owns client trial-request state/UX. This branch changes none of their files.
- In the current server, `functions/api/trial-request.js` performs a pending-queue count and a subsequent separate `INSERT OR IGNORE`. Two concurrent validated requests observing 149 pending can both insert, creating 151 pending rows despite a stated 150-request cap. This is a source-code concurrency failure, **not an observed production incident**.
- Fix: retain preliminary capacity UX check but add a bound queue-count condition to the very same SQLite `INSERT ... SELECT ... WHERE` statement. Check D1 write metadata; when the conditional write inserts no row, recheck public queue capacity before acknowledging. A duplicate below the capacity remains a neutral 202 receipt, without disclosing another applicant's identity.
- Deterministic adversarial test: force two independent synthetic requests to both read a preflight count of 149. Old code admits both (151); patched atomic gate must admit only one (150), refusing the other. Existing duplicate/rate-limit/privacy tests unchanged.
- Independent SQL syntax and count check: Python sqlite3 in a temporary in-memory database with 151 distinct synthetic write attempts returned changes=1 for entries 149 and 150 and changes=0 for entry 151; final count=150. This does not replace real D1/Cloudflare CI.
- No additional package, external code copy, new license obligation, tracking, email, Stripe, provider send, contact with real users, price change or deployment.
- Rollback: revert this isolated PR. Schema, public API contract and pricing unchanged. `node --test pipeline/trial-private-intake.test.js` plus existing CI required before release.

## Hunter A: verified demand-friction hypothesis, not measured willingness to pay
- NYC Department of Buildings officially states that DOB NOW: Build filings do not appear in BIS and instructs researchers to inspect both systems for a comprehensive address view. Source: https://www.nyc.gov/site/buildings/industry/dob-now-build-faqs.page (checked 2026-10-31). Hypothesis: mixed-source reconciliation and clearly dated filings may reduce screening time for equipment/ventilation vendors. Neither time savings nor conversion was measured.
- Source-specific official dataset: https://data.cityofnewyork.us/Housing-Development/DOB-NOW-Build-Job-Application-Filings/w9ak-ipjd (dataset excludes some categories; never call it complete coverage).
- Competitor-published prices checked 2026-10-31: https://permitlify.com/ lists $79/month starter for scored contractor permit alerts; its site displays inconsistent 3-day versus 7-day trial language. https://permitura.com/ lists $499/month Starter with seven-day no-card trial. These target different buyers and geographic scope. Neither vendor statement proves an actual sale or PermitPlate's $79 price-market fit.
- Next demand test (non-outbound): instrument verified aggregate visit→trial-receipt→accepted-trial→paid conversion with owner-approved privacy controls and independently verified provider receipts; do not substitute simulated browser clicks for buyers.

## Hunter B: honest conversion and QA
- Fix protects a time-sensitive no-card pilot intake from false capacity guarantees. The count is *pending review requests*, not subscribed customers and not the separate ten-business trial admissions.
- Before/after reproducible test target: **2 accepted / 151 pending → 1 accepted + 1 rejected / 150 pending**, from the same 149-record synthetic fixture. Real incoming conversion outcomes, customer experience and uptime remain unmeasured.

## Hunter C: delivery and economics guardrails
- Preserve exact same-origin JSON POST, one-domain dedupe, HMAC-IP budget, source-bound manual review, absence of automatic enrollment, private D1 storage, 202 receipt and refusal on errors.
- Production paid receipts, actual customer count, net revenue, traffic, acquisition costs and retained gross margin are **not accessible or verified**. Do not report 0 dollars without a reconciled payment ledger.
- Estimated engineering effort avoided by focused repair/test rather than debugging a live full-queue incident: **1–3 engineer-hours**, planning judgment only, low confidence; neither elapsed engineer time nor cost saving observed.
- Release blocker: this is a draft production-adjacent backend change. Do not merge or deploy without protected CI and independent website-owner release approval. Coordinate with #156 if its frontend is released first.

## Next priority, in order
1. Verify exact-head native GitHub workflow and realistic D1 response semantics for the conditional INSERT and duplicate behavior.
2. Confirm production roll-forward/revert plan with approved site owner, without touching live configuration.
3. Measure consented aggregate funnel with actual opt-in requests and provider-confirmed conversion if available; do not create synthetic customer rows.
