# PermitPlate NYC

PermitPlate converts selected official NYC restaurant applicant, licensing, buildout, pre-permit, and material-change records into source-linked research briefs for restaurant vendors.

Canonical site: <https://p00nsmasher.github.io/permitplate-nyc/>

## Customer offer

- $79/month through Stripe-hosted Checkout
- one supported vendor category and NYC territory
- up to 25 qualifying signals per brief
- optional labeled seven-day Starter Snapshot, capped at 10
- delivery when qualifying activity is available; some days may have no report
- cancel at period end through the Stripe customer portal
- seven-day first-payment refund window

Scores prioritize research. They are not purchase intent, opening probability, or guaranteed leads.

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
- Stripe Checkout is the payment and preference authority.
- Operational detection and opportunity ledgers belong in a dedicated private repository.
- Customer artifacts require explicit owner send authorization and provider reconciliation.
- Source-partial or source-unavailable runs fail closed.

See:

- [business model](BUSINESS_MODEL_V7.md)
- [system contract](MODEL_V7.md)
- [private state migration](operations/PRIVATE_STATE_MIGRATION.md)
- [first-subscriber runbook](operations/FIRST_SUBSCRIBER_RUNBOOK.md)
- [delivery verification](operations/DELIVERY_VERIFICATION_RUNBOOK.md)

## Readiness language

The controlled first-subscriber state and commercial-proof state are deliberately separate. Do not describe PermitPlate as commercially proven until a genuine paid subscriber has completed provider-backed delivery/reconciliation and the next run has verified duplicate suppression.
