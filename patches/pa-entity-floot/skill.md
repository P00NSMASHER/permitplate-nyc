# PA Entity Lookup x402

Use this service when an agent needs structured Pennsylvania Department of State business-registration facts from a company name.

## Paid endpoint

GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10

Price: $0.005 USDC
Protocol: x402 v2
Network: Base mainnet (eip155:8453)

## Good use cases

- Pennsylvania business registry lookup
- company identity resolution
- legal-entity enrichment
- vendor/customer verification
- due diligence
- filing-number lookup
- registration-type lookup
- registered address / city / ZIP / county confirmation
- lead enrichment

## Input

- q: required business name or distinctive fragment, 2-200 characters
- limit: optional integer 1-25, default 10

## Output

The paid response returns query, count, results, source, and paid=true.
Each result includes businessName, filingNumber, registrationType, address1, address2, city, state, zip, and county.

Planned backward-compatible enrichment adds creationDate, countyCode, and source-published principal/officer rows.

## Limitations

This is a factual registry-data lookup, not legal advice.
Do not treat the response as proof of current good standing unless the Pennsylvania source explicitly establishes that fact.
Do not infer missing officer names or legal authority.

## Discovery

OpenAPI: https://pa-entity-x402.floot.app/openapi.json
LLM guide: https://pa-entity-x402.floot.app/llms.txt
