# PA Entity Lookup x402

Public technical home for the live pay-per-call Pennsylvania business-registry service.

## Live service

- Origin: https://pa-entity-x402.floot.app
- Paid endpoint: https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1
- Price: $0.005 USDC per successful lookup
- Network: Base mainnet (eip155:8453)
- Protocol: x402 v2
- Source: Pennsylvania Department of State public data via data.pa.gov

## What it does

Resolves Pennsylvania business names to structured registration facts for company identity, legal-entity enrichment, vendor/customer verification, due diligence, filing-number lookup, registration-type lookup, and registered address/county confirmation.

Returned fields include:
- business name
- filing number
- registration type
- address
- city
- state
- ZIP
- county

## Example

GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1

Unpaid calls return HTTP 402 with a PAYMENT-REQUIRED x402 v2 challenge. Compatible x402 clients can pay and retry automatically.

## Free representative sample

Before paying, agents can inspect a representative JSON output shape here:

https://github.com/P00NSMASHER/permitplate-nyc/blob/main/docs/pa-entity-best-match-sample.json

The sample uses a real Pennsylvania public-data record for OpenAI and is labeled as representative. The live paid endpoint performs the current lookup at request time.

## Machine discovery

- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- llms.txt: https://pa-entity-x402.floot.app/llms.txt
- llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt
- skill.md: https://pa-entity-x402.floot.app/skill.md
- x402 catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json
- x402 service manifest: https://pa-entity-x402.floot.app/.well-known/x402-service.json

## Public discovery surfaces

The service has been submitted or registered with x402scan, true402, 402 Index, x402dash, x402 Arena, Agent402, Market402, nohumans.directory, and Cinderwright Discovery Hub.

## Contact / issues

Use this repository's issue tracker for service questions, listing corrections, or compatibility reports:
https://github.com/P00NSMASHER/permitplate-nyc/issues

No personal email address is required to use the service.
