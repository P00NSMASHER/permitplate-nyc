# Product 006 deployment plan — SEC Filing Freshness Check x402

Status: deterministic/source-contract-verified staging. Fresh live SEC smoke from GitHub Actions is blocked by SEC/Akamai policy, not by application logic.

## Contract

- Route: `GET /api/sec-filing-freshness`
- Price: `$0.005 USDC`
- Atomic amount: `5000`
- Network: `eip155:8453`
- Inputs: exactly one of `ticker` or `cik`; optional `form`; optional `maxAgeDays` 1–365 (default 30)
- Decisions: `recent_filing`, `no_recent_filing`, `company_not_found`

## Authoritative sources

- ticker map: `https://www.sec.gov/files/company_tickers.json`
- submissions: `https://data.sec.gov/submissions/CIK##########.json`
- filing URLs: SEC EDGAR Archives

The adapter mirrors the already deployed SEC Recent Filings product’s source logic: ticker→CIK resolution, recent filing metadata extraction, exact form filtering, accession-number URL construction, and no semantic interpretation of filing contents.

## Freshness rule

`recent_filing` means at least one matching filing has `filingDate` on or after:

`checkedAt - maxAgeDays`

`no_recent_filing` means the SEC company resolved successfully but no matching filing falls within the requested window.

`company_not_found` means the requested ticker/CIK did not resolve to a submissions record.

## x402 ordering

`402 -> validate input -> verify payment -> SEC lookup -> settle -> 200`

- invalid input: 400, no settlement
- SEC transport/contract failure: 502, `chargeable:false`, no settlement
- unresolved verification/settlement: 503, retry same authorization
- completed result: settle before HTTP 200

## Claim boundary

The product reports SEC filing metadata and date freshness only.

It does not:
- interpret filing contents,
- determine materiality,
- determine whether a filing is positive/negative,
- provide investment advice,
- establish that no disclosure occurred outside the requested form or EDGAR metadata window.

## Verification completed

- direct SEC adapter unit tests: passing
- ticker/CIK normalization: passing
- exact form filter tests: passing
- not-found behavior: passing
- source-failure behavior: passing
- deterministic freshness tests: passing
- x402 ordering/payment tests: passing
- resource-level `accepts[]` discovery tests: passing
- factory CI: passing

## Live-source blocker

A GitHub-hosted diagnostic on 2026-10-02 observed:

- `www.sec.gov/files/company_tickers.json` -> HTTP 403, Akamai page titled "Request Rate Threshold Exceeded"
- `data.sec.gov/submissions/CIK0000320193.json` -> HTTP 403, Akamai page titled "Your Request Originates from an Undeclared Automated Tool"

Therefore the GitHub Actions environment cannot be used as authoritative fresh SEC proof at this time.

This does not establish a Product 006 code defect.

The existing AppDeploy SEC product uses the same SEC endpoints and source algorithm, but AppDeploy app usage/deployment is currently account-wide paused until the reported weekly reset.

## Required post-reset acceptance

Before production release:
1. Run SEC live smoke from the deployment environment with a compliant declared User-Agent.
2. Confirm AAPL resolves to CIK 0000320193.
3. Confirm at least one valid filing metadata row is returned.
4. Confirm unpaid Product 006 returns exact 402 / 5000 atomic USDC.
5. Confirm invalid input does not settle.
6. Confirm SEC source failure does not settle.
7. Confirm successful evidence settles before 200.
8. Confirm x402 catalogs expose resource-level `accepts[]`.
