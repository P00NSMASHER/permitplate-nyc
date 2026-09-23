# PermitPlate NYC

PermitPlate converts selected official NYC restaurant applicant, licensing, buildout, pre-permit, and material-change records into source-linked research briefs for restaurant vendors.

Canonical site: <https://p00nsmasher.github.io/permitplate-nyc/>

## Customer offer

- $79/month through Stripe-hosted Checkout
- one supported vendor category and NYC territory
- one founder-reviewed brief each week, with up to 10 matching signals
- first brief within five business days
- optional labeled seven-day Starter Snapshot, capped at 10
- a no-matches note when nothing credible qualifies
- cancel at period end through the Stripe customer portal
- seven-day first-payment refund window

The launch offer is manually curated and does not depend on a model score.
Automated scoring remains a research system and is not part of the customer
promise. Signals are research starting points, not purchase intent, opening
probability, or guaranteed leads.

## Local verification

Requires Node.js 22 or newer.

```sh
node --test
node build-site.test.js
node build-site.js
```

`node build-site.js` creates the exact deployable public artifact in `dist/`. The build allowlist excludes pipeline code, operational state, tests, internal model documents, and secrets.

## Production boundaries

- GitHub Pages is the only canonical public host.
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

## Readiness language

The controlled first-subscriber state and commercial-proof state are deliberately separate. Do not describe PermitPlate as commercially proven until a genuine paid subscriber has completed provider-backed delivery/reconciliation and the next run has verified duplicate suppression.

Do not activate the Payment Link until the launch-readiness controller reports
`firstCustomerOperationallyReady: true` for the founder-curated launch mode,
against initialized private state and a verified live Pages build.
