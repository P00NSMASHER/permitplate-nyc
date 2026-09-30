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

## Related x402 service

This repository also carries the deployment history for the separate [PA Entity Lookup x402 seller](docs/PA_ENTITY_X402.md), a pay-per-call Pennsylvania business-registry service for autonomous agents. It is operationally separate from the PermitPlate customer offer.

- **$0.001 USDC — Pennsylvania Business Registry: Best Match:** resolves a company name to one best-ranked Pennsylvania legal-entity record with filing number, registration type, registered address, city, ZIP, and county. Intended for company identity, vendor/customer verification, due diligence, business-registration lookup, registered-address verification, and lead enrichment.
- **$0.005 USDC — PA Entity Lookup: Multi Result:** returns multiple Pennsylvania registry candidates when an agent needs name disambiguation rather than a single best match.
- Both use x402 v2 on Base USDC with no per-buyer account or API key.
- Machine discovery, independent directory status, example calls, and the canonical live endpoints are documented in [docs/PA_ENTITY_X402.md](docs/PA_ENTITY_X402.md).

Current revenue reporting is deliberately strict: directory registrations, unpaid 402 probes, and operator tests are not counted as buyer revenue.

## Readiness language

The controlled first-subscriber state and commercial-proof state are deliberately separate. Do not describe PermitPlate as commercially proven until a genuine paid subscriber has completed provider-backed delivery/reconciliation and the next run has verified duplicate suppression.

Do not activate the Payment Link until the launch-readiness controller reports
`firstCustomerOperationallyReady: true` for the founder-curated launch mode,
against initialized private state and a verified live Pages build.
