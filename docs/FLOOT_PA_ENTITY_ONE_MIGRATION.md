# Floot $0.001 Root-Origin Migration

Purpose: move the proven `PA Entity Best Match x402` offer from the shared AppDeploy API origin onto the owned Floot origin so root-origin crawlers and smart routers can index it alongside the existing $0.005 multi-result route.

## Target production URLs

- $0.001 best match: `GET https://pa-entity-x402.floot.app/_api/pa-entity-one?q=OpenAI`
- $0.005 multi result: `GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1`

Payout wallet, network, asset, and facilitator stay unchanged.

## Required payment terms

```text
payTo   0x708f7b52b56eafd7fc1de65fc7752ed732914021
network eip155:8453
asset   0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
name    USD Coin
version 2
scheme  exact
amount  1000
price   $0.001
```

## Response contract

```json
{
  "query": "OpenAI",
  "found": true,
  "match": {
    "businessName": "Openai, L.l.c.",
    "filingNumber": "0014371957",
    "registrationType": "Foreign Limited Liability Company",
    "address1": "600 North Second Street, Suite 401",
    "address2": null,
    "city": "Harrisburg",
    "state": "PA",
    "zip": "17101",
    "county": "Dauphin"
  },
  "source": "Pennsylvania Department of State via data.pa.gov",
  "paid": true
}
```

If no match exists, `found=false` and `match=null`.

## Search behavior

Reuse the existing Floot `business_name`-only PA Open Data search and ranking:

1. case-insensitive match against `business_name`;
2. normalize common legal suffixes (LLC, Inc., Corp., etc.);
3. exact normalized legal-name match first;
4. starts-with match second;
5. broader substring match after that;
6. return only the first ranked record.

Do not go back to Socrata `$q`, because that searches non-name fields and previously produced false positives such as matching "Sheetz" inside a street address.

## New Floot endpoint

Create:

- `endpoints/pa-entity-one_GET.ts`
- `endpoints/pa-entity-one_GET.schema.ts`

Behavior:

1. Evaluate the x402 payment challenge before validating `q`.
2. Unpaid request returns production HTTP 402 using Floot's `x-floot-status: 402` mechanism internally.
3. Accept both `PAYMENT-SIGNATURE` and legacy `X-PAYMENT`.
4. Verify against PayAI with the route-specific 1000-atomic requirement.
5. Validate `q` after a payment payload is present.
6. Query PA Open Data and compute one ranked match.
7. Do **not** settle if PA Open Data fails.
8. Settle only after the result is ready.
9. Successful response includes `PAYMENT-RESPONSE` and `x402-settled: true`.

## Route-specific Bazaar metadata

Do not reuse the multi-result Bazaar extension.

Best-match input:

```json
{
  "type": "http",
  "method": "GET",
  "queryParams": {
    "q": "OpenAI"
  }
}
```

Best-match output example:

```json
{
  "query": "OpenAI",
  "found": true,
  "match": {
    "businessName": "Openai, L.l.c.",
    "filingNumber": "0014371957",
    "registrationType": "Foreign Limited Liability Company",
    "address1": "600 North Second Street, Suite 401",
    "address2": null,
    "city": "Harrisburg",
    "state": "PA",
    "zip": "17101",
    "county": "Dauphin"
  },
  "source": "Pennsylvania Department of State via data.pa.gov",
  "paid": true
}
```

Input schema requires only `q` (string, minLength 2). Output schema must describe the single `match` object, not `results[]`.

## Root discovery changes

Update the following in the same production build:

### `static/openapi.json`

Add `GET /_api/pa-entity-one` with:

- operationId: `resolvePennsylvaniaBusinessBestMatch`
- summary: `Resolve one best Pennsylvania business entity match`
- $0.001 fixed x402 price
- required `q`
- complete 200 response schema
- 400 / 402 / 502 / 503 responses
- buyer vocabulary:
  - Pennsylvania business registry
  - company identity
  - legal entity enrichment
  - vendor verification
  - due diligence
  - filing number lookup
  - registered address verification

Keep the $0.005 route unchanged and clearly distinguish:
- $0.001 = one best match
- $0.005 = multiple candidates / disambiguation

### `static/llms.txt`
### `static/llms-full.txt`
### `static/skill.md`

Lead with the $0.001 best-match route as the low-friction default. Explain that the $0.005 route is for ambiguous names and multi-record review.

### `static/.well-known/x402-catalog.json`

Publish both resources with independent amounts and route-specific Bazaar metadata.

### `static/.well-known/x402-service.json`

Set the primary endpoint to the $0.001 best-match route and list the multi-result route as the deeper alternative if the schema supports multiple resources.

### New `static/.well-known/agent.json`

Publish a simple agent discovery manifest pointing at:
- OpenAPI
- llms.txt
- skill.md
- $0.001 primary endpoint
- $0.005 secondary endpoint
- Base / USDC / x402 v2

### Optional `static/.well-known/agent-card.json`

Add an A2A-style public card only if it can be done without implying autonomous capabilities the service does not have. Describe it as a callable data service, not a reasoning agent.

## One-build acceptance tests

Before reindexing anything:

1. `/_api/pa-entity-one?q=OpenAI` -> 402 unpaid.
2. PAYMENT-REQUIRED exists and decodes.
3. amount = `1000`.
4. EIP-712 token name = `USD Coin`.
5. payTo is unchanged.
6. Bazaar input has only `q`.
7. Bazaar output is single-match shape.
8. `/_api/pa-business?q=OpenAI&limit=1` remains 402 at `5000`.
9. `/openapi.json` exposes two paid GET operations.
10. AgentCash discovery reports both routes and correct prices.
11. `llms.txt`, `skill.md`, x402 catalog, and agent manifest return 200.
12. Existing Sheetz ranking regression remains correct.

## Post-publish distribution order

Immediately after the root migration passes:

1. Agent402: `POST https://agent402.tools/api/index/register` with `{"origin":"https://pa-entity-x402.floot.app"}`.
2. x402scan: refresh/register the Floot origin.
3. 402 Index: refresh the already domain-verified Floot listing and add the new route where applicable.
4. Market402: submit the new root $0.001 URL for its independent canary queue.
5. x402dash: register the new root $0.001 URL.
6. x402 Arena: register a distinct best-match agent entry if duplicate rules allow.
7. nohumans: keep the existing verified AppDeploy cheap listing alive; add the root version only if doing so does not create misleading duplicate spam.
8. Recheck PayAI/Bazaar discovery after the first real settlement.

## Why this is the priority

Agent402 explicitly rejected the AppDeploy path-prefix base with:

`submit the bare origin (no path or query)`

and its index readback showed the shared `api-v2.appdeploy.ai` origin was not indexed. Therefore moving the $0.001 SKU to an owned root origin is required to combine the strongest price with root-origin discovery and smart routing.
