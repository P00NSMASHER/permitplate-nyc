# Autonomous Revenue Hunters | 2026-10-31 | Run 7: no-card conversion clarity

## Authoritative state and deduplication
- Canonical repository: `P00NSMASHER/permitplate-nyc`, `main` SHA `68e835b4c718deded5691a20faebc58b1f1dc2d1`, protected. At inspection there were **zero open PRs**.
- Previously separate work is **already merged**: #152 staged paid checkout, #155 source-date validation, #156 pending-receipt identity, #157 atomic pilot queue, #158 work-email validation. CaptureBrief's #172 was closed as duplicate after its code was integrated in protected-main #174. Do not reopen or duplicate these.
- This branch changes only `index.html`, `start.html`, the existing paid-hold contract test and this note. No provider, entitlement, telemetry, pricing, payment, customer state or deployment changes.

## Hunter A: testable demand thesis, not proof of willingness to pay
- Target persona **hypothesis**: a NYC restaurant-equipment/hood/fire supplier doing manual research on project filings who needs to distinguish real, dated project events from raw dataset churn.
- NYC DOB explicitly states that DOB NOW: Build filings do not appear in BIS: https://www.nyc.gov/site/buildings/industry/dob-now-build.page (checked Oct 31, 2026). This supports a **data-reconciliation workflow gap**, not a purchaser's willingness to pay.
- Earlier Hunter checks recorded competitor-advertised prices (not actual sales): Permitlify $79/month, Permitura $499/month, BuildDocket $199/trade/borough/month, with different product scopes. No new customer contact, survey, ad or claimed demand was manufactured.
- Source-backed buyer experiment remains: measure real, privacy-reviewed, opt-in visit→trial application→admission→authorized first delivery→paid purchase events with a verified provider ledger. Counts and denominators presently **unknown**.

## Hunter B: precise reproducible buyer confusion
- **Before in current main source:** site homepage description advertised `$79/month` without saying checkout was on hold; the announcement foregrounded price; the final CTA said **Start membership** although the page deliberately prohibited checkout. The membership page described the trial as “after membership checkout” and asked “Questions before checkout?” despite an active no-purchase hold.
- **After in isolated branch:** search description explicitly describes the no-card trial and paid hold; announcement and last action route directly to `trial.html`; the membership summary still honestly describes the future $79 rate; trial explainer and support copy no longer imply a checkout is possible. No new claims or commercial promises.
- Source-count regression: misleading “Start membership” final CTA **1→0**; old “after membership checkout” explainer **1→0**; old “Questions before checkout?” footer **1→0**. These are source-string changes, **not measured visitor conversions**.
- Existing `pipeline/public-paid-enrollment-hold.test.js` now asserts these negative contracts and correct trial links. Original website layout and no-JavaScript trial remain intact.

## Hunter C: delivery, safety and economics
- This PR merely clarifies the already enforced source-side hold; it **does not deactivate** an external saved Stripe payment link or establish that paid onboarding is operational. Paid launch still needs separately authorized provider-side readiness/reconciliation.
- No external code copied, new dependencies/licenses, tracking scripts/cookies, private customer data, external messages, Stripe access, charges, production host changes, or Work/Codex runs.
- Test command: `node --test pipeline/public-paid-enrollment-hold.test.js`; authoritative PR CI: `permitplate-core-required`, plus site-build and mobile-browser checks as applicable. Do not describe green CI before an actual successful run.
- Rollback: revert this PR before merge, or revert its targeted four-file commit series after authorized release. Future checkout reopening requires updating manifest, assertions and UX together under explicit owner authorization.
- Gross revenue, visitor conversion rate, payment count, net profit and actual engineer-hours saved remain **unverified**. Estimated low-confidence engineering effort avoided for future contradictory-copy debugging: **0.5–1 hour**, planning estimate, not observed savings.

## Next critical verification
1. Check exact PR-head CI and inspect browser/site build, repair failures on this branch.
2. Keep production and provider prices unchanged; only merge through genuinely satisfied protected rules and site-owner authority.
3. Independently validate both GitHub Pages and Cloudflare deployed identities after any separately approved release; GitHub commits do **not** prove live production behavior.
4. Pursue read-only provider-backed conversion denominators and genuine first-customer evidence; no synthetic demand in revenue reporting.
