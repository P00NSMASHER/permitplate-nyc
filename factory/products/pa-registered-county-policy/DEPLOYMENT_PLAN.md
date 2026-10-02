# Product 022 deployment plan — PA Registered County Policy x402

Status: live-source-tested design candidate awaiting final staging promotion.

## Contract
- Route: `GET /api/pa-registered-county-policy`
- Price: `$0.002 USDC`
- Atomic amount: `2000`
- Inputs: `company`, `allowedCounties`
- Decisions: `policy_match`, `policy_mismatch`, `company_not_found`, `human_review`

## Evidence
Source: Pennsylvania Department of State via data.pa.gov.

The gate resolves one strong registry entity and compares its source-published registered county against a normalized caller list.

## Charging semantics
- 402 before work when unpaid
- 400 invalid input, no settlement
- 502 registry transport failure, chargeable=false, no settlement
- completed policy match/mismatch is chargeable
- 503 unresolved payment state, retry same authorization
- 200 only after confirmed settlement

## Claim boundary
A policy match only means the registry county is in the caller list. It does not prove physical operations, headquarters location, service area, residency, local ownership, tax situs, good standing, authority, or legal compliance.

## Live evidence
OpenAI OpCo resolved to Openai Opco, Llc with registered county Dauphin (countyCode 22) and returned policy_match for allowedCounties=Dauphin,Schuylkill with zero source failures.
