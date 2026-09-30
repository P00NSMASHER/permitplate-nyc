# PA Entity Lookup x402 — Red-Team Findings

Date: 2026-09-30

Scope: live seller at `https://pa-entity-x402.floot.app`, public discovery surfaces, PayAI facilitator behavior, buyer-routing compatibility, payment bypass attempts, malformed payment handling, browser/CORS compatibility, and upstream search behavior.

## Executive result

The payment gate resisted the obvious bypass attempts tested:

- `paid=true` query spoof -> still 402
- `x402-settled=true` query spoof -> still 402
- forged `x402-settled: true` header -> still 402
- forged `PAYMENT-RESPONSE` -> still 402
- bearer/authorization spoof -> still 402
- `X-HTTP-Method-Override: GET` -> still paywalled
- forged `x-floot-status: 200` -> still 402
- Range request -> still 402
- HEAD -> 402 with PAYMENT-REQUIRED
- malformed non-base64 payment header -> 402 `invalid_payment_header`

No free data path was found through the tested alternate routes.

However, several discovery and compatibility defects materially reduce buyer odds.

---

## P0 — Canonical x402 discovery path missing

### Evidence

Live requests currently return **403 AccessDenied** for:

- `/.well-known/x402`
- `/.well-known/x402.json`
- `/.well-known/x402-services.json`

Agent402 accepts the seller registration request but reports:

- `error: probe backed off: /.well-known/x402`
- `health: 0`
- `routable: false`
- `routerDispatchReason: crawl_failed`

This is a direct buyer-routing failure.

### Fix

Publish the already parser-tested `x402-manifest.json` at all three paths.

The exact fixture was validated against Agent402's current `normaliseManifestTools` parser with all checks true:

- route
- Base network
- payTo
- $0.005 price
- `USD Coin` EIP-712 domain
- manifest provenance

### Release gate

Agent402 re-registration must no longer return `crawl_failed`, and seller health must become nonzero.

---

## P0 — Valid facilitator rejections are misreported as 503 outages

### Evidence

Direct PayAI call with an invalid/empty payment payload returns HTTP **400** with a structured normal verification rejection:

```json
{
  "isValid": false,
  "invalidReason": "invalid_payload",
  "invalidMessage": "x402Version: Invalid input"
}
```

But sending a base64-encoded empty JSON payment payload to our live endpoint with a valid query returns:

```
503
{"error":"payment_verifier_unavailable"}
```

Therefore the seller is treating a facilitator's ordinary 4xx verification rejection as facilitator downtime.

### Why this matters

- third-party verifiers can mark the service unhealthy;
- malformed buyer payloads look like infrastructure failures;
- monitoring cannot distinguish invalid credentials from a real PayAI outage;
- routers may penalize reliability.

### Fix

For `/verify`:

1. Parse the facilitator JSON body on 4xx responses.
2. If it returns `isValid:false`, treat that as a normal payment rejection.
3. Return the x402 402 challenge with a safe rejection reason such as `invalid_payload` / `payment_verification_failed`.
4. Reserve **503** only for transport failure, timeout, unparsable response, or genuine facilitator 5xx.

Apply the same distinction to settlement error handling where appropriate.

---

## P1 — Browser x402 clients are blocked by CORS

### Evidence

A cross-origin GET with:

`Origin: https://buyer.example`

returns the correct 402 and PAYMENT-REQUIRED, but **no**:

- `Access-Control-Allow-Origin`
- `Access-Control-Expose-Headers`

An OPTIONS preflight returns 204 but does not expose the CORS headers needed for a browser client using `PAYMENT-SIGNATURE`.

### Impact

Server-side agents work, but browser wallets / browser-hosted autonomous clients cannot reliably read `PAYMENT-REQUIRED` or send the payment header cross-origin.

### Fix

Paid GET responses should include at least:

```
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE
Vary: Origin
```

OPTIONS should allow:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: PAYMENT-SIGNATURE, X-PAYMENT, Content-Type
Access-Control-Expose-Headers: PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE
```

If Floot intercepts OPTIONS before the endpoint, verify whether an explicit `pa-business_OPTIONS` endpoint can override it. Do not claim browser compatibility until an external preflight proves these headers are present.

---

## P1 — Advertised skill.md is not actually machine-readable Markdown

### Evidence

`GET /skill.md` returns:

- HTTP 200
- `content-type: text/html`
- ~17.8 KB app-shell HTML

The x402 catalog currently advertises:

`https://pa-entity-x402.floot.app/skill.md`

So a crawler following the advertised skill URL receives the SPA HTML instead of the skill document.

### Fix options

Preferred:
- publish a real root `skill.md`/ `SKILL.md` only if Floot can serve it as raw `text/markdown` or `text/plain`.

Otherwise:
- expose a raw machine endpoint that actually returns the skill body, and point manifests to that URL;
- or remove the broken skill link and rely on `llms.txt` + OpenAPI rather than advertising a false surface.

### Release gate

External GET must return the actual skill content, not HTML.

---

## P1 — Live Bazaar output example understates the product

### Evidence

The live 402 challenge's Bazaar example currently advertises:

```json
{
  "query":"OpenAI",
  "count":0,
  "results":[]
}
```

But the x402 catalog correctly carries the real OpenAI record.

This creates cross-surface disagreement and tells buyer agents that the advertised example may return nothing.

### Fix

Use one canonical representative example everywhere. For OpenAI:

- `Openai, L.l.c.`
- filing `0014371957`
- Foreign Limited Liability Company
- Harrisburg, PA / Dauphin County

After V2 enrichment, include source-published creation date and principals only if the live response schema includes them.

---

## P2 — No maximum query length

### Risk

The public contract has `minLength:2` but no `maxLength`. A paid caller can submit a very long `q`, creating oversized upstream Socrata filters/URLs and unnecessary source load.

### Fix

Set and enforce a conservative maximum, e.g. **160 or 200 characters**, in both:

- endpoint validation;
- OpenAPI/Bazaar JSON schema.

Normalize whitespace before measuring effective query length.

---

## P2 — Trailing-slash and legacy-route behavior is unfriendly

### Evidence

- `/_api/pa-business/?q=OpenAI` -> 404
- `/api/pa-business?q=OpenAI` -> 200 SPA HTML

There is no payment bypass, but stale integrations can misdiagnose the service.

### Fix

Do not add duplicate paid implementations.

If Floot supports safe lightweight aliases:
- redirect canonical legacy/trailing-slash forms to `/_api/pa-business` while preserving query parameters and never redirecting a request carrying a payment credential in a way that drops payment headers.

Otherwise leave them undocumented; canonical discovery must name only the correct route.

---

## P2 — A2A discovery paths are absent

### Evidence

Both currently return 403:

- `/.well-known/agent-card.json`
- `/.well-known/agent.json`

### Fix

Optional after P0/P1 items: add a small A2A card describing the HTTP+JSON tool and linking OpenAPI/x402 discovery. This broadens agent-framework compatibility but is not more important than restoring x402 routing.

---

## P3 — security.txt absent

`/.well-known/security.txt` currently returns 403.

This is not a buyer blocker, but a simple project-URL Contact field would improve trust without publishing a personal email.

---

## Confirmed good behavior

### Payment gate

All tested spoof/bypass attempts stayed paywalled.

### Headers / status

Unpaid canonical GET:
- HTTP 402
- application/json
- `PAYMENT-REQUIRED`
- Base `eip155:8453`
- Base USDC
- 5000 atomic units
- payTo unchanged
- `cache-control: no-store`

### Facilitator

PayAI currently advertises x402 v2 `exact` support for `eip155:8453`.

### CDP compatibility

Coinbase/CDP validator previously returned:
- `valid: true`
- simulation: `accepted`

### PayAI discovery stats

At red-team time:
- settlements total: 0
- unique buyers: 0
- total volume: $0
- reliability: 100

Revenue therefore remains **$0.00**.

---

## Search/product improvements already validated

The richer Pennsylvania current-business source can add:

- source creation date;
- county code;
- published principal/officer roles and names.

Measured fast-path search:

- OpenAI starts-with: ~0.11s
- Sheetz starts-with: ~0.19s
- Wawa starts-with: ~0.20s

Measured officer enrichment:
- 3 filing numbers: ~0.44s
- 5 filing numbers: ~0.74s

Use **starts-with first**, broad contains only as fallback.

Do not call creation date a legal good-standing indicator.
Do not infer missing officer names or current authority.

---

## Release order after Floot resets

1. **Fix P0 canonical manifest.**
2. **Fix P0 verifier error mapping.**
3. **Fix/externally prove CORS.**
4. **Fix or remove broken skill.md advertisement.**
5. **Make live Bazaar example consistent and useful.**
6. **Bound q length.**
7. Update operationId/summary/tags for buyer intent.
8. Add V2 enriched source fields using the benchmarked fast path.
9. Optional A2A + security.txt.
10. Republish once.
11. Run external regression:
   - canonical manifest aliases;
   - paid 402;
   - malformed payment -> 402, not 503;
   - CORS preflight;
   - skill raw content;
   - CDP validate;
   - AgentCash discover/check;
   - Agent402 re-register/health/router;
   - x402scan refresh;
   - 402 Index/nohumans;
   - PayAI stats.
12. Do not count any validation as revenue. Only a third-party settlement changes the revenue number.


---

## P1 — Settlement-pending responses can be misreported as unpaid failures

PayAI's current developer reference states that settlement is **idempotent** and that a settlement can return `settlement_pending` with a broadcast transaction hash. The transfer may still land; the documented recovery is to re-submit the **identical settle request** to obtain the eventual definitive result.

### Risk in the current integration

The seller currently treats facilitator non-success responses too generically. If a settle call is pending or its HTTP response is lost after broadcast, a buyer could ultimately pay while receiving a 503/no product.

### Fix

1. Preserve the exact settle request body after verify succeeds.
2. Parse structured settle responses even on non-2xx.
3. If `errorReason === "settlement_pending"` (or equivalent documented shape), retry the **identical body** with bounded exponential backoff inside the request deadline.
4. Because settle is idempotent, never generate a different payment/settle body for the same authorization.
5. If still unresolved, return an explicit `payment_settlement_pending` response with the facilitator transaction hash/reference. Never say “payment was not settled” when the state is unknown.
6. Do not count a pending transaction as revenue until a definitive settlement result/on-chain evidence exists.

This is payment-correctness, not just nicer error text.

---

## P2 — Facilitator economics become material at this price

Current PayAI public pricing says facilitator fees are a **flat per-settlement cost**, separate from the API's customer price. The live Base EIP-3009 rate observed during red-team testing was about **2.31 credits = $0.00231** per settlement at that moment.

At a $0.005 customer price, once the free credit allowance is exhausted:

- customer price: $0.005
- facilitator cost at the observed rate: ~$0.00231
- gross remainder before all other costs: ~$0.00269

The rate can change with network costs, so this is not a fixed future margin.

### Current decision

**Do not raise the price yet.** There are zero third-party buyers, and $0.005 is competitively positioned for machine purchase.

### Volume trigger

Once real settlements begin:

- record facilitator credits consumed per settled call;
- calculate realized net revenue per service;
- revisit price before the free credit allowance is materially consumed;
- compare PayAI's then-current rate with alternative compatible facilitators rather than silently accepting negative/near-zero unit economics.

Do not attempt to evade facilitator pricing by creating wallets solely to multiply free allowances.

---

## P2 — Free-tier exhaustion needs an explicit failure mode

PayAI documents that exhausted settlement credits can return HTTP 403 with an `errorReason` beginning `free_tier_exhausted`.

The seller must not translate this into generic `payment_verifier_unavailable`.

### Fix

Map it to an operator-actionable service state such as:

`facilitator_credit_required`

while still preventing settlement/product delivery until payment infrastructure is restored.

Once real volume exists, monitor this condition before it becomes customer-facing downtime.

---

## P2 — Normalized-invalid queries can become upstream-looking errors

The current search normalizes wildcard characters such as `%` and `_`. A raw two-character query can pass the public minimum length but normalize to fewer than two usable characters.

Example class:

- `q=%%`
- `q=__`

The current search helper can then throw `query_too_short_after_normalization`, which risks being caught as an upstream/source failure rather than a clean buyer input error.

### Fix

Validate the **normalized** search term before payment verification/upstream fetch and return 400:

`q must contain at least 2 searchable characters`

Do not label normalized-invalid input as PA registry downtime.

---

## P2 — Source freshness/provenance is underspecified for due-diligence use

The Commonwealth's data policy explicitly says data is provided **as-is** with no warranty of accuracy, timeliness, completeness, or fitness for a particular purpose.

For a tool marketed around company identity and due diligence, the response should make provenance and freshness clearer.

### Fix

Where practical, add stable source metadata such as:

- source dataset name;
- source dataset ID;
- source URL;
- source last-updated timestamp / `sourceAsOf` when it can be obtained reliably.

Do not market “Current Business Entities” as a legal conclusion that an entity is currently active or in good standing.

---

## P3 — Public security contact can be added without exposing personal email

`/.well-known/security.txt` is currently absent.

If Floot permits a raw static file, publish an RFC 9116-style file using a **project/public URL** contact surface rather than a personal email. This is optional trust hardening after buyer-blocking discovery/payment issues are fixed.
