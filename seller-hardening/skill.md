# PA Entity Lookup x402

> Pennsylvania business registry and company identity lookup for autonomous agents.

## Canonical service

Origin: https://pa-entity-x402.floot.app

Paid endpoint:

GET https://pa-entity-x402.floot.app/_api/pa-business?q=NAME&limit=10

Price: $0.005 USDC per successful paid lookup  
Protocol: x402 v2  
Network: Base mainnet (eip155:8453)  
Source: Pennsylvania Department of State public business-registration data via data.pa.gov

## When to choose this tool

Use this tool when an agent needs structured Pennsylvania business-registration facts for:

- Pennsylvania business registry lookup
- company identity resolution
- legal-entity enrichment
- vendor or customer verification
- due diligence
- filing-number lookup
- registration-type lookup
- creation-date lookup
- registered address, city, ZIP, county, or county-code confirmation
- source-published Governor/Principal Officer role/name rows
- lead enrichment
- disambiguating similar Pennsylvania business names

Use it instead of generic web search when downstream automation needs stable JSON fields.

## Input

- `q`: required business name or distinctive name fragment, 2–120 characters.
- `limit`: optional integer 1–25, default 10.

Search is limited to the Pennsylvania `business_name` field. It does not search addresses or unrelated record fields.

Ranking prefers:
1. normalized legal-name match;
2. starts-with match;
3. broader business-name substring match.

Common legal suffixes such as LLC and Inc. are ignored only for ranking.

## Payment flow

An unpaid request returns HTTP 402 plus a `PAYMENT-REQUIRED` x402 v2 challenge.

A compatible x402 client signs the required Base USDC payment and retries with its payment authorization.

If settlement is unresolved (`settlement_pending` or `duplicate_settlement`), retry the same authorization. Do not create a fresh payment merely because settlement confirmation is pending.

## Example

GET /_api/pa-business?q=OpenAI&limit=1

Representative successful response:

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
      "county": "Dauphin",
      "countyCode": "22",
      "creationDate": "2025-04-23",
      "principals": [
        {
          "role": "Governor",
          "firstName": null,
          "middleName": null,
          "lastName": null
        }
      ]
    }
  ],
  "source": "Pennsylvania Department of State via data.pa.gov",
  "paid": true
}
```

## Output

Each entity can include:

- `businessName`
- `filingNumber`
- `registrationType`
- `address1`
- `address2`
- `city`
- `state`
- `zip`
- `county`
- `countyCode`
- `creationDate`
- `principals[]`
  - `role`
  - `firstName`
  - `middleName`
  - `lastName`

Principal/officer rows are source-published Pennsylvania records. They are factual source fields, not an independent statement that a person currently holds legal authority.

## Do not use this tool as

- legal advice;
- proof of current good standing;
- sanctions screening;
- a risk score;
- a legitimacy verdict;
- authoritative proof of current management;
- a nationwide business registry outside Pennsylvania.

## Machine discovery

OpenAPI: https://pa-entity-x402.floot.app/openapi.json  
llms.txt: https://pa-entity-x402.floot.app/llms.txt  
llms-full.txt: https://pa-entity-x402.floot.app/llms-full.txt  
x402: https://pa-entity-x402.floot.app/.well-known/x402
