# Hardened PA Entity seller core

This directory is a staging bundle for the next Floot production release.

It exists because Floot's free build-action quota is currently exhausted until the account's fixed daily reset. The files here let the payment and registry logic be tested independently before the next live write.

## Red-team defects addressed in the core

- Parse PayAI `/verify` JSON even when HTTP status is non-2xx.
- Accept verification **only** when `isValid === true`; generic `success:true` is not enough.
- Treat `settlement_pending` and `duplicate_settlement` as unresolved and require retrying the **same payment**, never a fresh 402.
- Distinguish invalid payment from facilitator outage.
- Reject malformed/oversized payment headers before facilitator work.
- Strictly validate integer limits instead of permissive `parseInt`.
- Normalize query text and cap length before PA data/facilitator work.
- Escape Socrata string literals.
- Use fast business-name starts-with search first, then broader contains only as fallback.
- Use the richer PA current-business dataset with creation date and batched source-published principal/officer enrichment.
- Use a real successful OpenAI result in Bazaar metadata.
- Preserve exact Base USDC price and receiving wallet.

## Still requires Floot wrapper wiring after quota reset

The live endpoint wrapper must:

1. Return the x402 402 challenge before input validation when no payment header is present.
2. Decode a supplied payment header, then validate `q` and `limit` before calling PayAI.
3. Call PayAI with an abort timeout and parse JSON even on non-2xx.
4. For `VerifyDecision.invalid`, return a fresh 402 with the specific reason.
5. For `VerifyDecision.unavailable`, return 503 without a new payment challenge.
6. Fetch PA entity candidates with timeout.
7. Fetch principal enrichment in a single batched request when filing numbers exist.
8. Settle only after the registry result is ready.
9. For `retry_same_payment`, return a retryable non-402 status with `Retry-After` and instructions to replay the same `PAYMENT-SIGNATURE`.
10. For `payment_failed`, return a 402 because the buyer needs a new authorization.
11. For facilitator/network ambiguity, return 503 without a new 402.
12. On final settlement success, return `PAYMENT-RESPONSE` and `x402-settled:true`.

## Discovery files in the same production release

Publish the parser-tested `x402-manifest.json` at:

- `/.well-known/x402`
- `/.well-known/x402.json`
- `/.well-known/x402-services.json`

Also fix `/skill.md` so it serves raw Markdown rather than the Floot HTML shell, and add explicit CORS/exposed payment headers for browser-side x402 clients.
