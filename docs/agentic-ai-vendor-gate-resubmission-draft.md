# Agentic.ai Resubmission Draft — Pennsylvania Vendor Intake Gate

_Status: draft only — do not send until Floot bare-origin consolidation and Agent402 re-indexing are complete._

## Current availability incident — 2026-10-02

As of **2026-10-02 13:04 UTC**, the AppDeploy shared API edge is returning HTTP 402 with `x-appdeploy-app-availability: temporarily-unavailable`, body code `APP_TEMPORARILY_UNAVAILABLE`, and no seller `PAYMENT-REQUIRED` header for the AppDeploy-hosted x402 services. Reapplying the current vendor-gate deployment did not clear the condition.

This is being tracked in [incident #38](https://github.com/P00NSMASHER/permitplate-nyc/issues/38). The direct Floot rehost is tracked in [recovery #39](https://github.com/P00NSMASHER/permitplate-nyc/issues/39).

The two Floot Pennsylvania raw routes remain healthy and continue to return valid x402 challenges. Do **not** treat the AppDeploy vendor gate or other AppDeploy-hosted routes as currently buyer-available until the zero-spend buyer verifier is green again.

## Proposed listing name

Pennsylvania Vendor Intake Decision Gate

## One-line description

A pay-per-call agent-loop check that evaluates a prospective Pennsylvania vendor across state registry identity, Census address consistency, OFAC SDN candidate-name screening, and RDAP domain evidence, then returns `proceed` or `human_review` with explicit reasons.

## Why this is different from the earlier submission

The earlier services were raw data APIs. This product is a composed decision/checking tool intended to be called inside an autonomous workflow.

Instead of returning only records, it:

1. resolves the likely Pennsylvania legal entity,
2. rejects ambiguous or incomplete registry identity evidence,
3. compares the submitted address with the registry address using Census-normalized evidence,
4. screens the vendor name for OFAC SDN candidates,
5. verifies authoritative RDAP registration evidence,
6. checks whether the registered domain plausibly aligns with the vendor name,
7. returns an explicit workflow action:
   - `continue_vendor_intake`, or
   - `pause_and_request_human_review`.

The gate is fail-closed: incomplete, ambiguous, or inconsistent evidence results in `human_review`, not silent automatic continuation.

## Paid endpoint after Floot recovery

**Do not send this draft until this target is live and independently verified.**

`GET https://pa-entity-x402.floot.app/_api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN`

Price: **$0.020 USDC per successful paid call on Base via x402 v2**

Inputs:

- `name`
- `address`
- `domain`

Primary outputs:

- `decision: proceed | human_review`
- `agentAction: continue_vendor_intake | pause_and_request_human_review`
- typed `reviewTriggers`
- `checkedAt`
- policy metadata
- structured PA registry evidence
- structured Census address evidence
- structured OFAC evidence
- structured RDAP evidence
- explicit limitations

## Live bounded reviewer fixtures

These fixtures run the same decision engine but accept only fixed sample cases; they do not expose arbitrary free vendor screening.

### Expected proceed

`GET https://pa-entity-x402.floot.app/_api/vendor-intake-demo?case=proceed`

Expected:

- `decision=proceed`
- no review triggers
- PA registry/Census/OFAC/RDAP evidence complete

### Expected address review

`GET https://pa-entity-x402.floot.app/_api/vendor-intake-demo?case=address_mismatch`

Expected:

- `decision=human_review`
- trigger includes `registered_address_differs`

### Expected domain review

`GET https://pa-entity-x402.floot.app/_api/vendor-intake-demo?case=domain_mismatch`

Expected:

- `decision=human_review`
- trigger includes `domain_name_not_aligned`

## Fail-closed review conditions

The gate pauses for human review when any of these conditions is present:

### Pennsylvania registry

- no matching registry record
- multiple strong legal-entity candidates
- weak name match
- incomplete core identity record

Automatic continuation requires exactly one strong candidate plus a business name, filing number, registration type, and usable registered address.

### Census

- incomplete Census evidence
- supplied address not geocoded
- missing registry address
- registry address not geocoded
- normalized street number or ZIP mismatch
- coordinate distance greater than the configured 0.25-mile threshold

### OFAC

- incomplete OFAC evidence contract
- at least one SDN name candidate at or above the configured review threshold

The OFAC component is name screening only. A no-candidate result is not sanctions clearance, and the product does not perform OFAC 50 Percent Rule ownership analysis.

### RDAP

- incomplete RDAP evidence
- domain not confirmed registered
- registered domain does not plausibly align with the submitted vendor name

RDAP and name alignment do not prove domain ownership or control.

## Payment behavior

- x402 version 2
- Base network: `eip155:8453`
- Base USDC
- 20,000 atomic units = $0.020
- payout address: `0x708f7b52b56eafd7fc1de65fc7752ed732914021`
- facilitator: `https://facilitator.payai.network`

Unpaid calls return HTTP 402 with `PAYMENT-REQUIRED`.

Payment is verified before the paid workflow. If a required evidence source fails before a usable result is produced, the service returns an upstream error and does not settle the payment. Settlement occurs only after a successful decision result is produced.

## Machine discovery after Floot recovery

**Target URLs; verify publicly before sending this draft.**

- x402 manifest:
  `https://pa-entity-x402.floot.app/.well-known/x402`
- OpenAPI:
  `https://pa-entity-x402.floot.app/openapi.json`
- llms-full:
  `https://pa-entity-x402.floot.app/llms-full.txt`
- skill:
  `https://pa-entity-x402.floot.app/skill.txt`
- reviewer evidence:
  `https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/vendor-intake-gate-evidence.md`

## Evidence that must be added before sending

Do not submit until the following section can be completed with current evidence:

### Bare-origin discovery evidence

- Floot origin:
  `https://pa-entity-x402.floot.app`
- expected consolidated manifest resource count: 8
- Agent402 listed: **[pending]**
- Agent402 routable: **[pending]**
- Agent402 health: **[pending]**
- vendor-intake gate visible in Agent402: **[pending]**
- routes/documents rechecked: **[pending]**

This evidence should be refreshed immediately before submission.

## Suggested resubmission note

> Following your feedback on the earlier raw data APIs, I built a composed tool that makes/checks a bounded workflow decision rather than only returning data. The Pennsylvania Vendor Intake Decision Gate combines registry identity, address consistency, OFAC candidate-name screening, and authoritative RDAP evidence, then returns either `proceed` or `human_review` with typed reasons and source evidence. It is intentionally fail-closed: ambiguous, incomplete, or inconsistent evidence pauses the agent for human review. The paid x402 endpoint is $0.020 USDC on Base, and three fixed live fixtures let reviewers exercise both continuation and review branches without exposing arbitrary free checks. The listing includes explicit limitations and does not claim legal, sanctions, fraud, credit, ownership, or good-standing approval.

## Commercial truthfulness

At draft time, and until the Floot rehost is publicly verified:

- attributable third-party buyers: **0**
- confirmed third-party revenue: **$0**
- paid verification of the composed gate: **not yet confirmed**

Do not imply that self-tests, directory submissions, probes, registrations, shared-wallet activity, or seller-funded calls are customer revenue.
