# Autonomous Revenue Hunters | 2026-11-01 | Trial intake parity

## Canonical state and ownership
- Connected GitHub identifies `P00NSMASHER/permitplate-nyc` as the **public** authoritative repo, default `main`, with a current v4 customer-facing trial page (legacy founder-curated v2 offering preserved). This work starts from its main tree `7df42af483dee087eef5708c0d3f275e928383cb`.
- Open draft source-hunter PR #160 changes `operations/delivery-verifier.js`, not the three files here. CaptureBrief PRs #176 and #177 have separate owners. Do not merge or deploy without release permission and real branch checks.
- Issues #16 and #154 separately describe a possible direct Stripe Payment Link bypass and automatic Cloudflare Pages deployments on main. These are not cured by this PR, and protected main stays unchanged.
- No commercial private data, secrets or personally identifying contact details were accessed.

## Hunter A: real public buyer-problem and competitor evidence (NOT purchases)
- NYC DOB expressly distinguishes records in BIS versus DOB NOW; both are needed for some property histories: https://www.nyc.gov/site/buildings/dob/find-building-data.page and https://home4.nyc.gov/site/buildings/industry/dob-now-public-portal.page (accessed 2026-11-01). This supports the **source-reconciliation problem**, not an established buyer need.
- Rival PourWire advertises a 14-day no-card trial and a founding `$49/metro/month` offer for restaurant filing leads: https://pourwire.com/ (accessed 2026-11-01). Posted competitor pricing and displayed availability are **self-reported claims**, not verified sales, occupancy, conversion, or willingness to pay.
- Distinct differentiator hypothesis, currently **untested**: a vendor prefers a verified project event with dated permit/source provenance and category fit over a generic opening-list alert. Treat a voluntary in-scope application as intent to learn, not proof of paid demand.
- Cheapest permitted discovery path: existing organic examples plus explicit opt-in trial. No cold messaging, ad purchases, or scraped individual lead lists.

## Hunter B: reproducible free-trial request defect
Browser code `trial-request.js` previously accepted three inputs that private `functions/api/trial-request.js` rejected or transformed:
1. A syntactically legal but 256-byte ASCII hostname. Backend enforces <=253 bytes; browser did not, causing a form request to fail only after submission. Browser and email fallback now reject early.
2. ASCII DEL (U+007F) embedded in a business name. Backend refuses it; browser previously omitted DEL from control-character screening. Browser now refuses it before submission.
3. A decomposed Unicode company name, e.g. `Café Supplies`, was displayed as typed in browser while the backend normalized the durable name to NFC. Browser now normalizes to NFC too.

Only client validation and unit tests change. All existing categories, territories, request API/JSON fields, D1 admission, form copy, consent, accessibility, trial duration, no-card/NO_SEND boundaries and prices remain unchanged.

- `trial-request.test.js` covers all three browser conditions and ordinary request success.
- `pipeline/trial-private-intake.test.js` verifies D1 intake refuses both adversarial inputs without persisting, while continuing to accept the Unicode positive control.
- Reproducible commands (Node >=20): `node --test trial-request.test.js pipeline/trial-private-intake.test.js` and standard repository CI.
- No dependencies, licenses, network requests or runtime telemetry added. Uses built-in `String.prototype.normalize` and standard validation.
- Rollback: close this draft PR or revert its focused commits. No production change before approved merge/deploy.

## Hunter C: delivery and economics gates
- The product remains a supervised no-card trial with founder review; a 202 response is not admission, fulfillment or a sale.
- Funnel baselines and post-fix outcomes (real visitors, valid submissions, in-scope approvals, deliveries, Stripe purchases, refunds, contribution margin): **unavailable/unknown**. Never substitute a test request for a purchaser.
- This patch should reduce *a class* of form-to-API 400 errors; actual error-rate and conversion lift are **unmeasured**.
- Engineer-hours saved are **not measured**. A low-confidence planning estimate is 0.5–2 hours of future debugging avoided if an affected request occurred, not realized time or ROI.
- Release hold: verify exact-head required GitHub checks, Cloudflare external deployment path, live endpoint and provider-side Stripe link safeguards before any production merge. Do not change payment links or live settings in this PR.
- Next bounded experiment: with approved privacy-preserving aggregate analytics, record unique trial-page visits, successful receipt count, scope approval and paid subscriptions by cohort for 14 days; compare against a prespecified baseline without collecting private buyer details.
