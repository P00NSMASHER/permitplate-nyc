# Autonomous Revenue Hunters | 2026-10-31 | Focused iteration 5

## Exact authoritative state
- Repository: `P00NSMASHER/permitplate-nyc`; baseline `main` at `7cc9b1dd98e3ac00d00d4bcef856993237277751`.
- Existing open owner PRs reviewed: #152 (paid checkout hold, landing/release rules) and #155 (evidence date validation). Neither edits `trial-request.js` or `trial-request.test.js`. No merge, deployment or pricing change.
- This PR is isolated to the no-card trial browser UX, its deterministic test, operator documentation and this record.

## Hunter A: source-checked demand context, not verified willingness to pay
- Target persona hypothesis: NYC restaurant-equipment or ventilation vendor who spends time filtering current public activity for plausible projects. Buying trigger hypothesis: a few source-linked, human-reviewed records are more actionable than a broad lead list. No verified prospect expressed this preference.
- [Permitlify](https://permitlify.com/): vendor-published general permit-lead starting price **$79/month**, card-required seven-day trial, reviewed 2026-10-31. Not category-matched to PermitPlate.
- [Permitura](https://permitura.com/): vendor-published construction lead Starter **$499/month** and no-card seven-day trial, reviewed 2026-10-31. Geography and service level differ.
- [BuildDocket](https://builddocket.com/): vendor-published NYC violation/compliance alerts **$199 per trade/borough/month**; not restaurant-specific and not equivalent to research briefs, reviewed 2026-10-31.
- These are **price anchors from competitor claims**, not sales evidence, attainable conversion rates, or a basis to change the current $79 offer. No ads, outreach or price tests were initiated.

## Hunter B: concrete buyer-state defect and bounded repair
- Source-level baseline: a pending online POST could resolve after a buyer edited the form. Old success hid the edited form and displayed a receipt without explaining the new values were not sent; old error restored a previously built mailto draft using stale values. The submit handler did not itself prevent a second submit event during an in-flight POST.
- Patch: bind the UI response to the submission-time form revision; explain earlier success with later unsent edits; suppress stale email fallback on late error; allow only one in-flight request. Preserve the original exact HTTPS origin, D1 endpoint, immutable server-side acceptance, pricing and consent.
- Deterministic tests: unchanged happy path, delayed accepted POST after territory change, delayed rejected POST after territory change, duplicate submit before resolution. Fake responses and fictional data only, no network.
- Rollback: revert this isolated PR. No new dependencies, external source copies, license/NOTICE change, customer data or runtime secrets.

## Hunter C: inbound delivery integrity
- The no-card intake is still founder-supervised, not self-enrollment, recurring billing or automated outbound. A formerly ambiguous response after an edit now differentiates submitted facts from unsent facts, avoiding erroneous user expectations and outdated email drafts.
- Checkout/Stripe integration deliberately untouched because PR #152 owns that buyer-critical and deployment-sensitive surface.

## Evidence and economics
- Static baseline and precise files above are source-observed. New tests require native CI before release; no browser or live conversion success is claimed by this note.
- Actual visits, completed trial requests, paying accounts, Stripe receipts, CAC, LTV, MRR and profit: **not independently observed**. Do not interpret missing measurements as zero.
- Engineering time avoided: **unmeasured**. Rough planning estimate 1–3 engineer-hours for independent race reproduction, defensive handling and regression design, **low confidence** and not a realized cost saving.
- Next safe action: inspect exact-head GitHub CI and native browser smoke. Keep PR draft until site owner approves any production-facing release. Separately instrument truthful aggregate inbound funnel counters only with privacy/security review, using approved platform data. No synthetic purchases.

## Source handling
- Own existing first-party application, no added third-party libraries. Checked alternatives were unnecessary for a six-line-state coordination defect; avoid dependency/license bloat.
- Prior runs remain authoritative for their distinct repairs. Do not duplicate PR #152/#155 or release without governance.
