# Product 023 deployment plan — PA Local Vendor Policy Gate x402

Status: live-source-tested design candidate awaiting final staging promotion.

## Contract
- Route: `GET /api/pa-local-vendor-policy-gate`
- Price: `$0.004 USDC`
- Atomic amount: `4000`
- Inputs: `company`, `allowedKinds`, `allowedCounties`, optional `minAgeDays`
- Decisions: `proceed`, `human_review`, `company_not_found`

## Evidence
One Pennsylvania Department of State registry lookup supplies:
- registration type -> normalized entity kind
- registered county
- creation date -> formation age

Automatic proceed requires all caller-supplied rules to pass.

## Charging semantics
- unpaid -> 402
- invalid policy -> 400, no settlement
- registry source failure -> 502, chargeable=false, no settlement
- completed policy failure -> human_review and chargeable
- unresolved payment -> 503, retry same authorization
- successful settlement -> 200 + PAYMENT-RESPONSE

## Claim boundary
Proceed only means the configured caller policy checks passed. It is not legal/compliance approval or proof of good standing, ownership, authority, local operations, tax situs, fraud risk, sanctions status, or creditworthiness.

## Live evidence
OpenAI OpCo resolved to Openai Opco, Llc:
- normalized kind: llc
- registered county: Dauphin
- creation date: 2025-09-29
- age: 368 days at smoke time
- policy: allowedKinds=llc,corporation; allowedCounties=Dauphin,Schuylkill; minAgeDays=30
- result: proceed
- source failures: none
