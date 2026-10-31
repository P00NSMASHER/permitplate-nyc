# PermitPlate free-trial: 1,000 fictional-customer end-to-end acceptance

**Evidence date:** 2026-10-30 America/New_York (CI jobs 2026-10-31 UTC).  
**Source reviewed:** `0f6452dad1e5b77bdcbca8ceaa59a69ea99bee13` (main before audit), QA branch `bfbd071b57caaedc7f0d71ee145f3537f8ef2065`.  
**Scope:** Public customer discovery/form + request draft, TEST-only private cohort/admission, fictional full report/delivery lifecycle, browser/mobile navigation, no-send, and bounded live GET checks.  
**Safety:** Zero actual customers, real emails, Stripe charges, LIVE enrolments, production state writes, or paid services. *A synthetic test is not proof of market demand or conversion.*

## Repeatable acceptance matrix

| Fixture / test | Count | Result |
|---|---:|---|
| Distinct fictional buyer requests processed by real `trial-request.js` | 1,000 | PASS |
| Category × territory coverage | 8 × 12 = 96 | PASS |
| Form input/edit and manual mailto draft handling through DOM VM | 1,000 | PASS |
| Private TEST-only admissions in isolated cohorts | 1,000 (100 × 10) | PASS |
| Eleventh request correctly refused in each full cohort | 100 | PASS |
| Full TEST-only customer lifecycles, first and weekly reports | 1,000 | PASS |
| TEST-only report documents (HTML + CSV, 2 reports/customer) | 2,000 | PASS |
| Unsafe input / duplicate / unauthorized-negative examples | 264 | PASS: rejected |
| Real browser mobile/tablet/desktop form, menu, validation tests | 2 browsers × 3 viewports | PASS |
| Production GET source bytes, CSP, build SHA, two private paths | 4 exact public assets, 2 private 404s | PASS |
| Real signup, mailto click, email, payment or delivery | 0 | No side effects |

**Primary hosted receipts**
- [Official PR core regression on source head](https://github.com/P00NSMASHER/permitplate-nyc/actions/runs/41161279176)
- [Actual Chromium/WebKit browser acceptance](https://github.com/P00NSMASHER/permitplate-nyc/actions/runs/41161279195)
- [Read-only live Cloudflare acceptance](https://github.com/P00NSMASHER/permitplate-nyc/actions/runs/41161279207)

The live site reported build source SHA `0f6452dad1e5b77bdcbca8ceaa59a69ea99bee13` at audit. Four public assets were exact matches after normalizing only Cloudflare's two `email_off` comment markers in HTML. Private `/pipeline/free-trial.js` and `/state/nyc-free-trials.json` both returned 404 without private bytes.

## User journey and likely conversion risks

1. **Form does not submit an application.** Clicking **Prepare my free-trial request** generates a `mailto:` link and a manual copyable message. The customer must separately send from their email client. No automatic intake, request receipt, status confirmation, or verified open slots. This is an intentional privacy/no-send design, not a failed network request. Expect avoidable friction, but the size of the drop-off is *unmeasured*.
2. **Shared-host identity truncation.** A website URL's pathname is silently discarded by the email draft (`website.origin`). Separate businesses hosted under different `sites.google.com/view/...` paths become indistinguishable and the private admission domain gate may reject the second. Verify actual company identity while preserving one-trial-per-business. Do not bypass deduplication.
3. **Weekly zero-match update accounting.** First useful nonempty authenticated send correctly starts the clock; no-matches must not do so. But the generic `recordDelivery` currently rejects no-match packets, including a potential no-match weekly update after an already valid first report. Owner needs a controlled receipt for such weekly notices to substantiate the weekly promise.
4. **Hard cap, no waitlist.** Lifetime supervised cohort is exactly ten including cancelled/expired records. If 1,000 distinct *eligible* businesses sought admission simultaneously, 990 would be beyond capacity. This is a hypothetical arithmetic bound, not measured traffic or funnel attrition.
5. **Value specificity.** Public government signals are research leads-to-investigate, not verified vendor buying needs. In these intentionally generic fixtures all 2,000 simulated category assessments were defer/decline, *not* customer feedback. Founder review must support useful category-and-borough rationales.
6. **Application response expectations** are not specific; a clear, achievable manual review target and real request acknowledgment would reduce uncertainty without changing automatic send permissions.

Detailed follow-up acceptance, with no-safety-regression guardrails: [Issue #145](https://github.com/P00NSMASHER/permitplate-nyc/issues/145).

## Release verdict

**GO for a maximum ten supervised, founder-reviewed, no-card requests, subject to actual source quality, operator approval, correct email delivery and private state.**  
**NO-GO for 1,000 unattended self-service trials** without safe automated receipt/queue handling, confirmed domain identity, weekly no-match receipt and observed value validation.

Neither the successful synthetic full lifecycle nor provider FICTIONAL receipt proves actual inbox delivery or real customer satisfaction. The optional `$79/month` conversion requires the customer's separate explicit checkout. x402 Floot expansion and scoring promotion are outside this trial acceptance.
