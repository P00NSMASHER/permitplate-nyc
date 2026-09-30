# PA Entity Lookup x402

Resolve Pennsylvania business names into structured Pennsylvania Department of State registration records.

## Best uses

Use this tool for:
- Pennsylvania business registry lookup
- company identity resolution
- legal-entity enrichment
- vendor or customer verification
- filing-number lookup
- registration-type lookup
- registered-address confirmation
- city / ZIP / county confirmation
- due diligence support
- lead enrichment

Do not use this tool as legal advice, a sanctions screen, a risk score, or proof of current good standing unless the underlying Pennsylvania source explicitly establishes that fact.

## Paid endpoint

GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10

Price: $0.005 USDC per successful paid lookup
Protocol: x402 v2
Network: Base mainnet (eip155:8453)
Asset: Base USDC

## Input

- q: required business name or distinctive name fragment
- limit: optional integer from 1 to 25, default 10

Matching is case-insensitive against the Pennsylvania business-name field. Exact normalized legal-name matches are ranked ahead of starts-with and broader substring matches.

## Example

GET https://pa-entity-x402.floot.app/_api/pa-business?q=OpenAI&limit=1

Representative paid response:

```json
{
  "query": "OpenAI",
  "count": 1,
  "results": [
    {
      "businessName": "Openai, L.l.c.",
      "filingNumber": "0014371957",
      "registrationType": "Foreign Limited Liability Company",
      "address1": "600 North Second Street, Suite 401",
      "address2": null,
      "city": "Harrisburg",
      "state": "PA",
      "zip": "17101",
      "county": "Dauphin"
    }
  ],
  "source": "Pennsylvania Department of State via data.pa.gov",
  "paid": true
}
```

## Machine discovery

- OpenAPI: https://pa-entity-x402.floot.app/openapi.json
- LLM guide: https://pa-entity-x402.floot.app/llms.txt
- Full guide: https://pa-entity-x402.floot.app/llms-full.txt
- Canonical x402 manifest: https://pa-entity-x402.floot.app/.well-known/x402
- x402 catalog: https://pa-entity-x402.floot.app/.well-known/x402-catalog.json

## Payment behavior

An unpaid request returns HTTP 402 with a PAYMENT-REQUIRED x402 v2 challenge.

A compatible buyer should:
1. read PAYMENT-REQUIRED;
2. authorize the requested Base USDC payment;
3. retry the same request with the payment signature;
4. read PAYMENT-RESPONSE after successful settlement.

If settlement is unresolved or pending, retry the same payment/request instead of creating a second payment.
