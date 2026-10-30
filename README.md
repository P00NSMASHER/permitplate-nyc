# PermitPlate NYC

PermitPlate converts selected official NYC restaurant applicant, licensing, buildout, pre-permit, and material-change records into source-linked research briefs for restaurant vendors.

Company site: <https://permitplate.retallyrecovery.com/> (Cloudflare Pages).
The established GitHub Pages site remains available separately at
<https://p00nsmasher.github.io/permitplate-nyc/>. Each host has its own
`build-info.json`; verify the actual host's commit when checking a release.

## PermitPlate 2.0 customer-facing brief

The production founder-curated report builder now publishes an action-first decision summary,
per-signal verification guidance, an evidence appendix and matching CSV guidance without
changing founder approval or source admission controls. Its production offer mode remains
`FOUNDER_CURATED_NO_SCORE_V1`; no automated buying-intent rankings are shipped.

The public [2.0 NYC case study](https://permitplate.retallyrecovery.com/case-study)
uses actual historical DOB filing IDs for a renovation at 532 Neptune Avenue, and
identifies source/tenant-identity limitations. A downloadable text report and a
browser print/save-PDF option show the output. This is a demonstration, not
a qualified customer lead or a live customer delivery.

## Customer offer

- $79/month through Stripe-hosted Checkout
- one supported vendor category and NYC territory
- one founder-reviewed brief each week, with up to 10 matching signals
- first brief within five business days
- optional labeled seven-day Starter Snapshot, capped at 10
- a no-matches note when nothing credible qualifies
- cancel at period end through the Stripe customer portal
- first-payment refund through seven calendar days after the first brief or
  no-matches message is sent; see the full first-delivery policy

## Free trial pilot

`trial.html` accepts a request by preparing a local email draft. It does not
submit an intake, enroll a customer, create a subscription or start billing.
The operator confirms scope before admitting up to 10 businesses, one trial
per business, using the private no-send trial workflow.

- One category and NYC territory; two reports with up to five reviewed signals each.
- Fourteen days begin at the first nonempty, authorized, provider-accepted send.
- A no-matches note and initial research baseline never start the clock.
- A separate explicit paid checkout is required to continue.
- Trial source accuracy, actual founder review and send authorization gates are
  the same as the paid research lane.

See [trial operation](operations/FREE_TRIAL_PILOT.md) and the
[October 27 real-source validation](verification/NYC_TRIAL_READINESS_2026-10-27.md).

The launch offer is manually curated and does not depend on a model score.
Owner-authorized V4 scoring runs inside the existing private research refresh
to rank **source-dated, source-linked research records only**. Undated applicants,
suppressed jurisdictions and disputed identities are held. Category evidence
caps prohibit interpreting a contextual keyword as verified buying intent.
**Customer-facing scored-lead delivery remains disabled**, and production buyer
precision has not been independently established. See
[NYC internal V4 scoring controls](operations/NYC_INTERNAL_V4_SCORING.md).
Signals are research starting points, not purchase intent, opening probability,
or guaranteed leads.

## Local verification

Requires Node.js 22 or newer.

```sh
node --test --test-concurrency=1 model-v7.test.js build-site.test.js build-standalone-site.test.js operations/*.test.js pipeline/*.test.js trial-request.test.js
node build-site.js
```

Run the two build tests sequentially: both intentionally verify the shared
`dist/` deployment directory. Bare `node --test` also discovers the separate
x402 live-network/tooling scripts and may run those build tests concurrently;
it is not the deterministic NYC product check above.

`node build-site.js` creates the exact deployable public artifact in `dist/`. The build allowlist excludes pipeline code, operational state, tests, internal model documents, and secrets.

## Code release approval

The repository uses **owner-authorized, automated-CI-gated code releases**. A separate
human or independent code reviewer is **not required**. Source-accuracy, payment,
data-privacy, scientific calibration and customer-send safeguards are separate
controls and remain in force. See
[Owner-authorized code release policy](operations/CODE_RELEASE_POLICY.md).

## Production boundaries

- The company host uses Cloudflare Pages; the established GitHub Pages artifact
  is built separately. Both use the same explicit public-file allowlist.
- Stripe Checkout is the payment and preference authority when paid enrollment is open.
- Operational detection and opportunity ledgers belong in a dedicated private repository.
- Customer artifacts require explicit owner send authorization and provider reconciliation.
- Source-partial or source-unavailable runs fail closed.

See:

- [business model](BUSINESS_MODEL_V7.md)
- [system contract](MODEL_V7.md)
- [private state migration](operations/PRIVATE_STATE_MIGRATION.md)
- [first-subscriber runbook](operations/FIRST_SUBSCRIBER_RUNBOOK.md)
- [founder-curated fulfillment](operations/FOUNDER_CURATED_FULFILLMENT.md)
- [delivery verification](operations/DELIVERY_VERIFICATION_RUNBOOK.md)

## Related x402 service

This repository also carries the deployment history for the separate [PA Entity Lookup x402 service family](docs/PA_ENTITY_X402.md). It is operationally separate from the PermitPlate customer offer.

- **$0.001 USDC — Pennsylvania Business Registry: Best Match:** resolves a company name to one best-ranked Pennsylvania legal-entity record.
- **$0.005 USDC — PA Entity Lookup: Multi Result:** returns multiple Pennsylvania registry candidates when an agent needs name disambiguation.
- **$0.020 USDC — Pennsylvania Vendor Intake Decision Gate:** combines PA registry identity, Census address consistency, OFAC SDN candidate-name screening, and authoritative RDAP domain evidence, then returns `proceed` or `human_review` with explicit reasons. The gate fails closed on ambiguous, incomplete, or inconsistent evidence.
- **Current availability:** the AppDeploy-hosted composed gate and non-PA routes are unavailable because the account's weekly hosting-credit allowance is exhausted; AppDeploy Support says it resets October 5, 2026 at 00:00 UTC and there is no path-level exemption for discovery files. No credits/upgrade are authorized. See incident #38 and Floot recovery #39. The two Floot PA raw routes remain healthy.
- All use x402 v2 on Base USDC with no per-buyer account or API key.
- Current service map: [docs/pa-entity-x402.md](docs/pa-entity-x402.md)
- Vendor-gate reviewer evidence: [docs/vendor-intake-gate-evidence.md](docs/vendor-intake-gate-evidence.md)

Current revenue reporting is deliberately strict: directory registrations, unpaid 402 probes, operator tests, shared-wallet activity, and seller-funded calls are not counted as buyer revenue. Confirmed attributable third-party revenue remains $0 until a genuine outside payment is observed.

## Readiness language

The controlled first-subscriber state and commercial-proof state are deliberately separate. Do not describe PermitPlate as commercially proven until a genuine paid subscriber has completed provider-backed delivery/reconciliation and the next run has verified duplicate suppression.

Do not activate the Payment Link until the launch-readiness controller reports
`firstCustomerOperationallyReady: true` for the founder-curated launch mode,
against initialized private state and a verified live Pages build.
