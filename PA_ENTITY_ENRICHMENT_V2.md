# PA Entity Lookup x402 — V2 enrichment release plan

## Goal

Increase buyer value **without increasing the $0.005 price** or adding a paid upstream dependency.

The next production release combines two improvements:

1. restore canonical x402 discovery/routing with `/.well-known/x402`;
2. enrich each Pennsylvania entity result with creation date and published principal/officer records from the same Pennsylvania Department of State public dataset.

## Source architecture

Use the Pennsylvania current-business dataset:

`https://data.pa.gov/resource/xvd7-5r2c.json`

The source can contain multiple rows per filing number because principal/officer rows are repeated with the entity record.

### Stage 1 — fast entity candidate search

Query a **distinct projection** of entity-level fields:

- business_name
- filing_number
- address_line1
- address_line2
- city
- state
- zip
- typeofbusinessregistration
- creationdate
- shortcountyname
- county_code

Search order:

1. First query: case-insensitive **starts-with** on `business_name`.
2. Rank candidates using the existing normalized legal-name scoring.
3. If the starts-with result set does not fill the requested limit, run the broader **contains** query and merge/deduplicate by filing number.
4. Never use whole-row `$q` because that can match an address instead of the business name.

Measured starts-with examples on 2026-09-30:

- OpenAI: ~0.114 s
- Sheetz: ~0.185 s
- Wawa: ~0.200 s

Measured broad distinct projection:

- OpenAI: ~1.699 s
- Sheetz: ~1.357 s
- Wawa: ~6.130 s

Therefore starts-with should be the default fast path and contains should be fallback-only.

## Stage 2 — principal/officer enrichment

For the filing numbers selected in Stage 1, make one batched request selecting only:

- filing_number
- party_type
- first_name
- middle_name
- last_name

Filter by:

`filing_number in (...selected filings...)`

Then group source rows by filing number.

Measured 2026-09-30:

- one OpenAI filing: ~0.550 s
- one Sheetz filing: ~0.438 s
- one Wawa filing: ~0.533 s
- three filings in one request: ~0.442 s
- five representative filings in one request: ~0.740 s

This is fast enough to include enrichment by default for normal result counts.

## Backward-compatible response extension

Preserve every existing response field.

Add to each result:

```json
{
  "creationDate": "2025-04-23",
  "countyCode": "22",
  "principals": [
    {
      "role": "Governor",
      "firstName": null,
      "middleName": null,
      "lastName": null
    }
  ]
}
```

Rules:

- `creationDate`: ISO date only when source value exists, otherwise null.
- `countyCode`: source county code when present, otherwise null.
- `principals`: source-published Governor/Principal Officer rows associated with that filing number.
- Keep distinct roles even when the same person appears under multiple roles.
- Remove only exact duplicate rows.
- Do not infer missing names.
- Do not call these records proof of current management or legal authority.
- Do not expose a “good standing” or active-status verdict because the source does not establish that.

If a batched officer query fails but Stage 1 succeeds, return the entity results with empty/unavailable enrichment rather than settling against a failed primary registry lookup. Implementation should make the failure semantics explicit before deployment.

## Verified representative source records

### OpenAI

- business: `Openai, L.l.c.`
- filing: `0014371957`
- creation date: `2025-04-23`
- source publishes a Governor row with no person name in that row.

### Sheetz

- business: `Sheetz, Inc.`
- filing: `0000326968`
- creation date: `1969-12-11`
- published rows include Governor Travis Sheetz, President Travis Sheetz, Vice President Adam Sheetz, and Secretary Gary Zimmerman.

### Wawa

- business: `Wawa, Inc.`
- filing: `0000233685`
- creation date: `1933-08-08`
- the source publishes multiple Governor/officer roles, including CEO, President, CFO, Treasurer, Vice President, Secretary, and Assistant Secretary rows.

## Discovery release in the same deployment

Add the exact validated `x402-manifest.json` document at:

- `/.well-known/x402`
- `/.well-known/x402.json`
- `/.well-known/x402-services.json`

Update OpenAPI operation metadata:

- `operationId: pennsylvaniaBusinessRegistryCompanyIdentityLookup`
- summary: `Pennsylvania business registry and company identity lookup`
- buyer terms:
  - Pennsylvania business registry
  - company identity
  - legal entity
  - vendor verification
  - due diligence
  - lead enrichment

Do not add unsupported claims such as sanctions screening, legal good standing, risk scoring, or authoritative current-management verification.

## Release gates

After the next production publish:

1. All three canonical x402 discovery URLs return 200 JSON.
2. Paid endpoint still returns HTTP 402 before payment.
3. `PAYMENT-REQUIRED` remains present.
4. Base USDC price remains 5000 atomic units ($0.005).
5. payTo remains unchanged.
6. Existing response fields remain backward-compatible.
7. OpenAI, Sheetz, and Wawa rank their intended legal entities first.
8. Enrichment returns creation date and grouped principal/officer rows.
9. Coinbase/CDP validator remains `valid: true` / simulation `accepted`.
10. AgentCash still discovers one paid GET route.
11. Agent402 self-registration succeeds and no longer reports `crawl_failed`.
12. Agent402 seller health becomes nonzero and the route becomes routable if no other gate blocks it.
13. Refresh x402scan and re-check 402 Index/nohumans positioning.
14. Do not count any of the above as revenue until an independent buyer settles USDC.
