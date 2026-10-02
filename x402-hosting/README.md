# x402 hosting migration — AppDeploy credit-gate removal

Date: 2026-10-02

## Decision

Keep the already-verified Pennsylvania seller on Floot:
- https://pa-entity-x402.floot.app

Move the other five sellers to dedicated Netlify Free origins so discovery and paid routes share one origin and AppDeploy credits are no longer on the runtime path.

| Seller | AppDeploy source snapshot | Target origin |
|---|---|---|
| SEC Recent Filings x402 | `sec-recent-filings-x402-f9qatj` | https://sec-recent-filings-x402.netlify.app |
| US Census Address Geocoder x402 | `us-census-address-geocoder-x402-23mj4x` | https://us-census-address-geocoder-x402.netlify.app |
| Treasury Average Interest Rates x402 | `treasury-average-interest-rates-x402-xeqftl` | https://treasury-average-interest-rates-x402.netlify.app |
| OFAC SDN Name Screen x402 | `ofac-sdn-name-screen-x402-m9ko96` | https://ofac-sdn-name-screen-x402.netlify.app |
| Domain RDAP Lookup x402 | `domain-rdap-lookup-x402-spdfnq` | https://domain-rdap-lookup-x402.netlify.app |

## Contract invariants

Every migrated seller preserves:
- x402Version: 2
- network: eip155:8453 (Base)
- asset: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
- extra.name: USD Coin
- extra.version: 2
- payTo: 0x708f7b52b56eafd7fc1de65fc7752ed732914021
- existing amount/price per seller
- PayAI facilitator behavior
- current upstream data-source logic

## Why this fixes the failure

The recurring failure is host-level: AppDeploy's exhausted weekly allowance returns 402 before discovery files can be served. These bundles run discovery and paid routes from the same Netlify origin, so /.well-known/* and /openapi.json are no longer behind AppDeploy's credit gate.

## Cutover gate

Do not change listings until each target passes:
- discovery 200s
- OpenAPI 200
- unpaid paid route returns the seller's own x402 402 challenge
- challenge decodes to the exact existing Base USDC terms
- demo/health route succeeds
- one malformed payment probe is rejected safely
- Agent402 registration/readback succeeds on the new origin

The AppDeploy deployments can remain untouched as rollback references; do not buy credits.
