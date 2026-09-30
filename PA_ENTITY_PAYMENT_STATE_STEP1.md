# PA Entity Lookup x402 — Step 1 payment-state hardening

This is the production patch contract for the live Floot seller.

## Required behavioral changes

### 1. Parse PayAI x402 response bodies even when HTTP status is non-2xx

Do **not** throw merely because `response.ok` is false.

For `POST /verify`, parse JSON first and classify by the x402 body:

- `isValid === true` → verified
- `isValid === false` → invalid buyer payment; return a 402 using `invalidReason`
- 429 / 5xx / transport failure / malformed facilitator response → 503 verifier unavailable
- never accept a generic `success: true` as verification success

This fixes the live red-team finding where PayAI returns HTTP 400 plus
`{"isValid":false,"invalidReason":"invalid_payload"}`
but the seller currently reports `503 payment_verifier_unavailable`.

### 2. Never create a fresh authorization for unresolved settlement

For `POST /settle`:

- `success === true` → settled; serve the resource with PAYMENT-RESPONSE
- `errorReason === "settlement_pending"` → retry the **same** settlement body
- `errorReason === "duplicate_settlement"` → retry/reconcile the **same** settlement body
- 429 / 5xx / lost response → retry/reconcile the **same** settlement body
- unknown response shape → fail safe as unresolved; do not issue a new payment challenge
- a known terminal settlement failure may return a fresh 402 if a new authorization is actually required

Use a bounded retry, e.g. three total settlement attempts with ~250ms then ~500ms backoff.

If still unresolved, return a retryable 503 such as:

```json
{
  "error": "payment_settlement_pending",
  "retrySamePayment": true
}
```

Recommended headers:

```text
Retry-After: 1
Cache-Control: no-store
```

Critically, **do not include PAYMENT-REQUIRED** on that unresolved response.

A client retrying the original HTTP request with the original PAYMENT-SIGNATURE will cause the server to verify and re-submit the identical settlement, which PayAI documents as idempotent.

### 3. Preserve buyer evidence

Do not log signed payment payloads or raw signatures.

Safe diagnostics:

- verify/settle HTTP status
- `invalidReason` / `errorReason`
- attempt number
- presence of transaction id (not the signed authorization)
- whether the final state was valid / invalid / settled / reconcile / terminal

## Regression requirements

The executable regression harness is:

`node --test tests/pa-entity-payment-state.test.mjs`

It must pass before the live endpoint is republished.

After Floot publish, repeat the live red-team checks:

1. base64 `{}` payment → 402 invalid payment, not 503
2. no-payment request → normal 402 challenge
3. settlement_pending fixture/mocked path → no fresh PAYMENT-REQUIRED
4. duplicate_settlement fixture/mocked path → no fresh PAYMENT-REQUIRED
5. successful settle → resource + PAYMENT-RESPONSE + x402-settled
6. settlement transport ambiguity → retry same payment and, if still unresolved, 503 without payment challenge

## Authoritative PayAI behavior

Current PayAI documentation states that verify/settle x402 response bodies are returned even on non-2xx statuses, that `settlement_pending` is unresolved rather than failed, and that identical settlement resubmission is idempotent. The seller must therefore branch on the response body and preserve the original authorization during recovery rather than synthesizing a new payment.
