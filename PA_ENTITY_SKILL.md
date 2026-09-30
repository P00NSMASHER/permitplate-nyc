# PA Entity Lookup x402

Use this tool for Pennsylvania business-registry lookup, company identity resolution, legal-entity enrichment, vendor/customer verification, due diligence, filing-number lookup, registration-type lookup, creation-date lookup, and registered-address/county confirmation.

Paid endpoint:

GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10

Price: $0.005 USDC per successful settled call.
Protocol: x402 v2.
Network: Base mainnet (eip155:8453).

## Input

- q: required company name or distinctive name fragment, 2-120 characters.
- limit: optional integer 1-25, default 10.

## Matching

The service queries the Pennsylvania business_name field case-insensitively.
It uses a fast starts-with search first and a broader contains search only when needed.
Normalized legal-name matches are ranked before broader matches.

## Output

Each result preserves the original fields:

- businessName
- filingNumber
- registrationType
- address1
- address2
- city
- state
- zip
- county

and adds:

- creationDate
- countyCode
- principals[] with source-published role, firstName, middleName, lastName

The response also reports whether principal enrichment completed.

## Limitations

The Pennsylvania source does not by itself establish current good standing, sanctions status, legal authority, risk score, or a legitimacy verdict. Principal/officer rows are source-published records and should not be treated as independent proof of current management authority.

## Payment recovery

If settlement is unresolved, retry the same request with the same PAYMENT-SIGNATURE. Do not generate a new authorization merely because the service returned settlement_pending or a transient 503.

OpenAPI: https://pa-entity-x402.floot.app/openapi.json
LLM guide: https://pa-entity-x402.floot.app/llms.txt
