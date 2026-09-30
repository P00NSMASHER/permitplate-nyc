# Next production routing patch

This file records the next seller-side changes for PA Entity Lookup x402.

## Why this patch exists

Agent402 currently parses the OpenAPI route but reports:

- `error: probe backed off: /.well-known/x402`
- `health: 0`
- `routable: false`
- `routerDispatchReason: crawl_failed`

Its self-serve registration endpoint accepts the origin, but refuses to list it while the canonical x402 discovery path is absent.

Coinbase/CDP's x402 validator has independently returned `valid: true` and simulation `accepted` for the existing live 402 challenge, so this patch does **not** change payment terms.

## Production files to add

Serve the exact JSON in `x402-manifest.json` at all three paths:

- `/.well-known/x402`
- `/.well-known/x402.json`
- `/.well-known/x402-services.json`

All three should return `200 application/json` and the same payment terms.

## OpenAPI operation metadata to strengthen

Keep the existing route:

`GET /_api/pa-business`

Change the agent-selection metadata to:

- operationId: `pennsylvaniaBusinessRegistryCompanyIdentityLookup`
- summary: `Pennsylvania business registry and company identity lookup`
- tags: `Pennsylvania Business Registry`, `Company Identity`, `Legal Entity`, `Vendor Verification`, `Due Diligence`

Recommended description:

> Search Pennsylvania Department of State business-registration records by company name. Use for Pennsylvania business registry lookup, company identity resolution, legal-entity enrichment, vendor/customer verification, due diligence, filing-number lookup, registration-type lookup, and registered-address/county confirmation. Returns structured JSON suitable for downstream agent workflows.

Do not claim:
- current good-standing status;
- sanctions screening;
- officers/directors;
- registered-agent details;
- a legitimacy or risk verdict.

Those are not currently in the source response.

## Regression gates after deployment

1. `/.well-known/x402` returns 200 JSON.
2. `/.well-known/x402.json` returns the same document.
3. `/.well-known/x402-services.json` returns the same document.
4. Paid route remains HTTP 402 when unpaid.
5. `PAYMENT-REQUIRED` remains present.
6. Price remains 5000 atomic Base USDC ($0.005).
7. payTo remains `0x708f7b52b56eafd7fc1de65fc7752ed732914021`.
8. CDP x402 validation remains `valid: true`.
9. AgentCash still discovers one paid GET route.
10. Agent402 self-registration returns listed/routable rather than `crawl_failed`.
11. Agent402 seller health becomes nonzero after a successful crawl.
12. Refresh x402scan and re-check 402 Index/nohumans search placement.
