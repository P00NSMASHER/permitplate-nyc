# PA Entity Lookup x402

Public technical home for the Pennsylvania business-registry x402 service family and the composed vendor-intake decision gate.

## Live raw-data origin

**Floot origin:** https://pa-entity-x402.floot.app

Paid endpoints:

- `GET /_api/pa-entity-one?q=NAME` — $0.001 USDC
- `GET /_api/pa-business?q=NAME&limit=N` — $0.005 USDC

Network: Base mainnet (`eip155:8453`)  
Protocol: x402 v2  
Source: Pennsylvania Department of State public data via data.pa.gov

The Floot origin is the current working bare-origin x402 seller and is already machine-discoverable. The composed vendor-intake gate has **not yet** been added to this Floot manifest; that consolidation is the next distribution step after the Floot daily build-action quota resets.

## Composed vendor-intake gate

**AppDeploy production API:** https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s

Paid endpoint:

`GET /api/vendor-intake-gate?name=NAME&address=ADDRESS&domain=DOMAIN` — $0.020 USDC

The gate is designed for an autonomous agent loop. It combines:

- Pennsylvania registry identity
- Census address evidence
- OFAC SDN candidate-name screening
- authoritative RDAP domain evidence

It returns:

- `decision=proceed` + `agentAction=continue_vendor_intake`, or
- `decision=human_review` + `agentAction=pause_and_request_human_review`

The gate fails closed to human review when registry, Census, OFAC, or RDAP evidence is ambiguous, incomplete, inconsistent, or hits a configured review condition.

A proceed result is only an intake workflow signal. It is not legal/compliance approval, sanctions clearance, fraud/credit approval, proof of current good standing, or proof of ownership/control of an address or domain.

## Reviewer evidence

Full reviewer checklist, x402 behavior, fail-closed trigger catalog, and live bounded fixtures:

https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/vendor-intake-gate-evidence.md

Zero-spend buyer-style verification runbook:

https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/x402-zero-spend-verification.md

Fixed live fixtures:

- expected proceed: `GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=proceed`
- expected address review: `GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=address_mismatch`
- expected domain review: `GET https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-demo?case=domain_mismatch`

These fixtures are fixed and bounded; they do not expose arbitrary free vendor screening.

## Machine discovery

### Floot raw-data origin

- canonical x402 manifest: https://pa-entity-x402.floot.app/.well-known/x402
- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt
- skill: https://pa-entity-x402.floot.app/skill.txt

### AppDeploy composed-gate mirror

- canonical x402 manifest: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402
- JSON alias: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/.well-known/x402.json
- OpenAPI: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/openapi.json
- llms.txt: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/llms.txt
- llms-full.txt: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/llms-full.txt
- skill: https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/skill.md

The AppDeploy OpenAPI currently documents the vendor gate with typed evidence-completeness fields and fail-closed review semantics.

## Raw registry data

The Pennsylvania lookup products can return:

- business name
- filing number
- registration type
- creation date when trustworthy
- registered address
- city/state/ZIP
- county and county code
- source-published principal/officer records when available

The raw registry products do not provide a legitimacy/risk verdict or prove current good standing.

## External distribution state

Raw PA endpoints already have public discovery/probe evidence across multiple x402 directories.

For the composed vendor gate specifically:

- Market402 submission accepted; instant self-test passed 11/11
- 402 Index registration accepted but pending because the AppDeploy origin is a shared domain
- Agent402 bare-origin routing is pending the Floot manifest consolidation
- paid verification: not yet confirmed
- attributable third-party buyers: 0
- confirmed third-party revenue: $0

Do not count self-tests, directory registration, probes, seller-funded traffic, or shared-wallet activity as revenue.

## Contact / issues

Use this repository's issue tracker for service questions, listing corrections, or compatibility reports:

https://github.com/P00NSMASHER/permitplate-nyc/issues

No personal email address is required to use the service.
