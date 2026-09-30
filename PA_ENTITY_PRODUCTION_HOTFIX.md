# PA Entity Lookup x402 — Production Hotfix

## Release priority

This hotfix must land before any further directory expansion.

### P0 — payment-state correctness

1. Parse PayAI JSON bodies even when `/verify` or `/settle` returns non-2xx.
2. Treat `isValid === false` as invalid payment and return a 402 carrying the same payment requirements.
3. Reserve 503 only for network failures, invalid facilitator responses, or true facilitator unavailability.
4. Do not accept generic `success:true` as verification success unless the facilitator contract explicitly documents it for that endpoint.
5. Treat `settlement_pending`, duplicate/already-settled, and other ambiguous settlement states as reconciliation states, not invitations to create a new payment.
6. Never emit a fresh payment challenge for a payment that may already be settling. Return a retryable non-402 response with a stable error code and preserve the original payment context.
7. Keep result-before-settle semantics: if the PA source fails, do not settle.

Recommended verification result handling:

```ts
const verifyResponse = await fetch(...);
const verifyText = await verifyResponse.text();
let verifyBody: any = null;
try { verifyBody = JSON.parse(verifyText); } catch {}

if (verifyBody?.isValid === false) {
  return paymentRequired(
    String(verifyBody.invalidReason ?? verifyBody.errorReason ?? 'payment_verification_failed')
  );
}
if (verifyBody?.isValid !== true) {
  if (!verifyResponse.ok) {
    return error('payment_verifier_unavailable', 503);
  }
  return error('payment_verifier_invalid_response', 503);
}
```

Settlement handling must distinguish:
- success;
- already-settled / duplicate but confirmed;
- pending / indeterminate;
- definite failure.

A pending/indeterminate settlement must **not** issue a new 402.

### P0 — canonical x402 discovery

Publish the parser-tested `x402-manifest.json` at:

- `/.well-known/x402`
- `/.well-known/x402.json`
- `/.well-known/x402-services.json`

All three must return:
- HTTP 200;
- `application/json`;
- identical canonical payment terms;
- x402 v2;
- Base `eip155:8453`;
- amount `5000`;
- Base USDC;
- current seller wallet.

The manifest fixture in `x402-manifest.json` has already passed Agent402's current `normaliseManifestTools` parser with all assertions true.

### P1 — fix advertised machine documents

`/skill.md` currently returns the HTML Floot app shell. Do not advertise it.

Publish the real machine skill at `/skill.txt` with `text/plain`, and point OpenAPI/x402 discovery at that same-origin URL.

Do **not** publish an A2A `/.well-known/agent-card.json` unless an actual A2A protocol binding is implemented; this release is an HTTP/x402 API, not an A2A message server.

Publish `/.well-known/security.txt` with a project-level GitHub security/policy contact only; do not expose personal email.

### P1 — Bazaar example correctness

The current live 402 challenge advertises the OpenAI example as:
- `count: 0`
- `results: []`

Replace it with a representative real response:
- `Openai, L.l.c.`
- filing `0014371957`
- Foreign Limited Liability Company
- Harrisburg, PA
- Dauphin County

Machine-facing examples should prove useful output.

### P1 — query validation

For unpaid requests, preserve x402-first behavior: no payment header -> 402 challenge.

After a syntactically decodable payment header is present, normalize and validate query parameters **before** calling PayAI.

Rules:
- `q` trimmed;
- minimum 2 meaningful characters;
- maximum 120 characters;
- reject values that normalize to fewer than 2 alphanumeric Unicode characters;
- limit must parse as a whole integer;
- 1 <= limit <= 25;
- reject malformed `10garbage` instead of silently reading 10.

Return 400 for invalid paid-attempt inputs without calling the facilitator.

### P1 — dependency timeouts

Add AbortController timeouts matching the staged release:
- PayAI verify/settle: 6 s per facilitator request;
- PA Open Data: 10 s per source request.

Do not leave serverless requests unbounded.

### P1 — CORS

Support browser-based x402 clients.

OPTIONS and API responses should include an intentional CORS policy.

At minimum for a public API:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, OPTIONS`
- `Access-Control-Allow-Headers: PAYMENT-SIGNATURE, X-PAYMENT, Content-Type`
- `Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE`

Keep `Cache-Control: no-store` on payment-bearing responses.

### P1 — OpenAPI routing vocabulary

Change operation metadata to:

- operationId: `pennsylvaniaBusinessRegistryCompanyIdentityLookup`
- summary: `Pennsylvania business registry and company identity lookup`

Include truthful tags/phrases:
- Pennsylvania Business Registry
- Company Identity
- Legal Entity
- Vendor Verification
- Due Diligence
- Lead Enrichment

Do not claim:
- good standing;
- sanctions screening;
- risk scoring;
- authoritative current-management verification.

### P2 — faster enriched registry results

Use the official officer-level dataset:
`https://data.pa.gov/resource/xvd7-5r2c.json`

Search:
1. fast case-insensitive starts-with query using a distinct entity projection;
2. rank using existing normalized legal-name scoring;
3. only if needed, broad contains fallback;
4. deduplicate by filing number.

Add backward-compatible fields:
- `creationDate` (treat exact source sentinel `1753-01-01` as unavailable/null; preserve other genuinely old dates)
- `countyCode`
- `principals[]` with source-published role/name fields

Benchmarks already measured:
- starts-with OpenAI ~0.114s
- Sheetz ~0.185s
- Wawa ~0.200s
- 3-filing principal enrichment ~0.442s
- 5-filing enrichment ~0.740s

### P2 — route hygiene

- `/api/pa-business` currently returns the HTML SPA with HTTP 200; ensure unsupported API-looking paths return a real API 404 if routing permits.
- trailing-slash behavior should be intentional.
- keep POST unsupported unless deliberately added.

## Required post-deploy gates

1. Unpaid canonical request -> 402.
2. PAYMENT-REQUIRED present.
3. Header/body accepts/resource parity.
4. Correct Base/USDC/amount/payTo.
5. Malformed base64 payment -> 402 invalid_payment_header.
6. Decodable invalid payment -> 402 invalid_payload, **not 503**.
7. Missing/invalid q with a payment payload -> 400 without facilitator call.
8. settlement_pending never triggers a fresh 402.
9. canonical well-known x402 paths -> 200 JSON.
10. skill.txt -> real machine-readable skill text, not HTML; do not advertise the broken `/skill.md` path.
11. Bazaar OpenAI example contains a real record.
12. OpenAI, Sheetz, Wawa rank correctly.
13. enrichment fields are present and grouped.
14. CORS exposes x402 headers.
15. Coinbase/CDP validator remains valid/accepted.
16. AgentCash still discovers the paid route.
17. Agent402 re-registration no longer reports crawl_failed.
18. Agent402 seller health becomes non-zero/routable if no independent-settlement gate remains.
19. x402scan/nohumans/402 Index are refreshed.
20. No technical success is counted as revenue until third-party USDC settles.
