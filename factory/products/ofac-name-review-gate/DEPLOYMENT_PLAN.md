# Product 009 deployment plan — OFAC Name Review Gate x402

Status: **live-source-verified staging**. Production deployment is deferred while AppDeploy is account-limit paused.

## Contract
- Route: `GET /api/ofac-name-review-gate`
- Price: **$0.003 USDC** / 3000 atomic units
- Inputs: `name`, optional `minScore` 70–100 (default 90)
- Decisions: `candidate_found`, `no_candidate`, `human_review`

## Source
Current U.S. Treasury OFAC SDN primary-name and alias CSV publications.

## Claim boundary
This is deterministic first-pass name/alias screening only. A candidate is a review signal, not a legal sanctions determination. A `no_candidate` result is not sanctions clearance. OFAC 50 Percent Rule ownership analysis is not included.

## Live verification
A neutral smoke query (`OpenAI OpCo`, threshold 90) successfully loaded the current OFAC source and returned a completed `no_candidate` result with zero candidates. This verifies source transport and decision execution; it is not a sanctions-clearance claim about the queried company.

## x402 ordering
`402 -> validate -> verify -> OFAC source work -> settle -> 200`. Source failure is HTTP 502 / non-chargeable / no settlement. Unresolved settlement is HTTP 503 and retries the same payment authorization.

## Deployment blocker
AppDeploy weekly Free-tier reset reported as `2026-10-05T00:00:00Z`. No upgrade/spend authorized.
