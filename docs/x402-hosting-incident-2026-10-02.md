# x402 hosting incident — 2026-10-02

## Status

**Active external-hosting blocker.**

At 2026-10-02 12:19–12:25 UTC, independent GitHub-hosted probes showed that all six AppDeploy-hosted x402 API families were being intercepted by the AppDeploy public edge before application code executed.

Affected AppDeploy families:

- PA Entity Lookup / Vendor Intake Gate
- SEC Recent Filings
- U.S. Census Address Geocoder
- OFAC SDN Name Screen
- Domain RDAP Lookup
- Treasury Average Interest Rates

The Floot PA seller remained externally healthy during the same probe window.

## External evidence

GitHub Actions run:

- workflow: `PA Entity Market402 refresh`
- run id: `37006560106`
- commit: `808fb43ab13d678f88942a78e2b3c539d91f3afd`

For each AppDeploy API sample, the external runner observed:

- HTTP 402
- `x-appdeploy-app-availability: temporarily-unavailable`
- body:
  `{"code":"APP_TEMPORARILY_UNAVAILABLE","message":"This app is temporarily unavailable. Please try again later. If the problem continues, contact the app’s support team."}`

The response did **not** come from the seller's x402 handler and therefore did not contain the seller's `PAYMENT-REQUIRED` challenge.

A same-snapshot re-apply of PA app version `1790932374587` did not restore external availability.

Internal AppDeploy status continued to report deployments as ready/deployed with no application-level frontend/backend errors, so internal deployment status is not sufficient evidence of public seller availability.

## Marketplace effect

The composed vendor-intake gate's full executable URL was refreshed against public directories during the incident.

Market402:

- endpoint remained reachable
- HTTP 402 was observed
- self-test passed only the transport/body checks
- x402 challenge checks failed because the platform interception body contained no `x402Version`, `accepts`, payTo, amount, or network
- current result during incident: **issues_found**, not spec-compliant

402 Index:

- refresh returned HTTP 422
- detail: endpoint returned 402 but no valid x402 challenge was detected
- the probe reported no `PAYMENT-REQUIRED` header

These failures are hosting-availability evidence, not proof that the underlying seller source is malformed.

## Zero-spend interpretation

AppDeploy's public documentation states that hosted apps consume credits and that when no usable credits remain, hosted apps stop running and resume automatically when credits return.

The observed portfolio-wide interception is consistent with that documented behavior, but the connected AppDeploy tools do not expose an account-usage/remaining-credit readout, so this repository does **not** claim which exact AppDeploy quota was exhausted.

No paid AppDeploy upgrade or top-up is authorized as part of this incident response.

## Working seller during incident

The Floot PA origin remained healthy:

https://pa-entity-x402.floot.app

Fresh Market402 checks during the incident:

- `/_api/pa-business?q=OpenAI&limit=1` — 11/11, `spec_compliant`
- `/_api/pa-entity-one?q=OpenAI` — 11/11, `spec_compliant`

These are self-tests, not Market402's independent 402 Verified badge.

## Recovery strategy

### Before Floot quota reset

- do not repeatedly redeploy/reapply AppDeploy versions
- preserve the hardened source and version history
- keep permanent external CI checking public availability
- stage Floot-native execution sources and expanded discovery documents
- do not claim the AppDeploy endpoints are currently buyer-usable
- do not resubmit Agentic.ai while the composed gate is externally unavailable

### At the Floot build-action reset

Floot project:

`b69a3ee6-eb01-430d-aa51-da2fc7beeac4`

Reset:

`2026-10-02T18:00:00Z` / 2:00 PM America/New_York

Priority order:

1. read the current Floot project once
2. preserve the two healthy PA paid routes
3. deploy a same-origin Floot-native `/_api/vendor-intake-gate` at $0.020
4. add the gate to the extensionless `/.well-known/x402` manifest and agent docs
5. publish once
6. externally verify the 402 challenge and bounded decision fixtures
7. register the Floot origin with Agent402 and verify the gate is actually recognized
8. migrate the remaining AppDeploy raw services to Floot-native endpoints if the AppDeploy public edge is still unavailable

## Revenue accounting

This incident changes no revenue accounting.

- attributable third-party buyers: **0**
- confirmed third-party revenue: **$0**
- seller-funded/self-test/directory probes: **not revenue**
