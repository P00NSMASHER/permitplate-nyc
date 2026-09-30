# PA Entity Lookup x402 — Red-team production repair gate

## Goal

Ship one post-quota production release that fixes every confirmed buyer-trust/payment-state defect without changing the $0.005 price, payout wallet, Base network, or successful unpaid 402 behavior.

## Confirmed live defects

### P0 — settlement ambiguity must never create a fresh payment request

If facilitator settlement returns an unresolved state such as `settlement_pending`, do **not** emit a fresh HTTP 402 that invites a new payment authorization.

Required behavior:
- preserve the original payment identity;
- return a retryable server response such as 202/503 with a stable machine-readable code like `settlement_pending`;
- include retry guidance if supported;
- never tell the buyer to generate a second payment for the same request;
- reconcile/retry the same settlement idempotently.

### P0 — parse verifier JSON on non-2xx responses

Live test:
- PayAI `POST /verify` with an invalid payload returns HTTP 400 and JSON:
  `{"isValid":false,"invalidReason":"invalid_payload",...}`
- the seller currently converts this to HTTP 503 `payment_verifier_unavailable`.

Required behavior:
- parse JSON bodies even when PayAI returns 4xx;
- if `isValid !== true`, return a normal invalid-payment 402 using the returned invalid reason;
- reserve 503 for actual transport outage, timeout, malformed facilitator response, or unreachable facilitator.

Do not use a generic `success:true` as sufficient verification evidence. Require the facilitator's explicit valid field for the x402 v2 verify path.

### P0 — canonical discovery files must be real 200 JSON

Confirmed production status:
- `/.well-known/x402` -> 403 AccessDenied
- `/.well-known/x402.json` -> 403 AccessDenied
- `/.well-known/x402-services.json` -> 403 AccessDenied

Agent402 currently backs off because of this and reports the seller unhealthy/unroutable.

Serve the already parser-tested manifest at all three paths with:
- HTTP 200
- `application/json`
- identical payment terms
- x402Version 2
- resource URL for the paid endpoint
- Base mainnet `eip155:8453`
- amount `5000`
- Base USDC
- existing payTo wallet
- Bazaar input/output metadata

### P1 — /skill.md must be Markdown, not the SPA shell

Confirmed production behavior:
- `/skill.md` -> HTTP 200
- content type/body is the HTML Floot app shell

Required:
- serve actual Markdown text
- `Content-Type: text/markdown` or `text/plain`
- keep catalog URL pointing to this real file

### P1 — Bazaar example must show a real successful result

Current live payment challenge advertises:
`OpenAI -> count: 0, results: []`

Replace the machine-facing example with a real representative Pennsylvania record already validated from the source:
- Openai, L.l.c.
- filing number 0014371957
- Foreign Limited Liability Company
- Harrisburg, PA
- paid: true

Do not fabricate unsupported fields.

### P1 — validate paid-query semantics before facilitator network calls

Preserve the useful behavior where a completely unpaid request receives the 402 challenge immediately.

After a payment header is syntactically decoded, validate the request before calling PayAI:
- normalize `q`;
- enforce minimum 2 useful characters after normalization;
- add a reasonable maximum input length;
- reject wildcard-only / punctuation-only inputs;
- require `limit` to parse as a clean integer rather than silently accepting strings like `10garbage`;
- clamp or reject values outside 1-25 consistently with OpenAPI.

This prevents invalid paid attempts from consuming verifier/upstream capacity.

### P1 — dependency timeouts

Add bounded AbortController timeouts to:
- PayAI verify
- PayAI settle
- Pennsylvania Open Data calls

Use explicit error codes to distinguish:
- facilitator timeout
- PA source timeout
- invalid payment
- settlement pending
- settlement rejected

### P1 — browser-agent CORS

Add explicit CORS for the paid route and discovery API responses where appropriate:
- allowed methods: GET, OPTIONS
- allowed request headers: PAYMENT-SIGNATURE, X-PAYMENT, Content-Type
- exposed response headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE, x402-settled, x402-price, x402-network, x402-asset, x402-pay-to
- vary on Origin if dynamically echoing origins

Do not weaken payment enforcement.

### P2 — routing cleanup

Current oddities:
- `/api/pa-business` returns the HTML SPA with 200
- `/_api/pa-business/` returns 404 while canonical no-slash path works

Preferred:
- legacy API-looking paths return an explicit API 404/redirect rather than HTML;
- canonical paid route remains unchanged to avoid breaking listings.

### P2 — discovery consistency

Keep one canonical x402 v2 truth across:
- 402 header/body
- `/.well-known/x402*`
- `/.well-known/x402-service.json`
- x402 catalog
- OpenAPI
- llms.txt
- llms-full.txt
- skill.md

Avoid an ambiguous `"x402":"1.0"` field if a crawler can mistake it for protocol version. If retained, rename it to an explicit manifest schema version.

Optional:
- `/.well-known/agent-card.json`
- `/.well-known/security.txt`

## Payment bypass gate

The following red-team probes already failed to bypass payment and must remain blocked:
- `paid=true` query spoof
- `x402-settled=true` query spoof
- `x402-settled: true` header spoof
- fake PAYMENT-RESPONSE
- fake Authorization bearer
- X-HTTP-Method-Override
- internal x-floot-status spoof
- Range request
- HEAD
- oversized payment header at edge
- SQL-ish query
- wildcard query

A release fails if any one of these returns paid registry data without a genuine successful x402 settlement.

## Regression matrix for the first post-quota publish

### Discovery
1. GET /.well-known/x402 -> 200 JSON
2. GET /.well-known/x402.json -> 200 JSON
3. GET /.well-known/x402-services.json -> 200 JSON
4. all three canonical manifests have identical accepts terms
5. GET /skill.md -> Markdown, not HTML
6. OpenAPI remains valid
7. llms.txt remains 200 text
8. catalog points only to URLs that actually return the advertised content

### Payment
9. unpaid valid request -> 402
10. PAYMENT-REQUIRED present
11. body/header payment terms match
12. network = eip155:8453
13. amount = 5000
14. asset = Base USDC
15. payTo unchanged
16. invalid base64 payment -> 402 invalid_payment_header
17. decoded-but-invalid payment -> 402 invalid_payload, not 503
18. real verifier outage -> 503
19. settlement pending -> retryable non-402 state, no fresh payment challenge
20. upstream PA failure before settlement -> no paid result and no settlement

### Input
21. q missing with unpaid request -> 402 challenge
22. q invalid after decoded payment -> 400, no facilitator verify call
23. punctuation/wildcard-only q rejected after payment header decode
24. overly long q rejected
25. limit=10garbage rejected
26. limit outside 1-25 handled consistently

### Security / bypass
27. every known spoof path remains blocked
28. wrong method does not return paid data
29. oversized headers are edge-rejected safely
30. no sensitive facilitator internals/secrets are reflected

### Buyer compatibility
31. Coinbase/CDP validator stays valid=true
32. AgentCash still discovers paid route
33. Agent402 registration no longer crawl_failed
34. Agent402 health becomes nonzero/routable if no external reputation gate blocks it
35. x402scan refresh succeeds
36. nohumans remains verified
37. Market402 status does not regress

### Product quality
38. OpenAI best legal entity remains first
39. Sheetz best legal entity remains first
40. Wawa best legal entity remains first
41. no address-field false positives for company-name searches

## Release rule

Do not publish piecemeal.

Apply payment-state fixes + canonical manifest + real skill.md + example correction + validation/timeouts/CORS in one controlled release, run this complete gate externally, and only then refresh buyer directories.
