# Floot production apply plan — hardened PA Entity seller

This is the execution order for the first build window after the Floot free-plan build-action reset.

## Inputs already tested

The following staging files are green:

- `seller-hardening/pa-entity-core.ts`
- `seller-hardening/pa-entity-core.test.ts`
- `seller-hardening/contract.test.ts`
- `seller-hardening/x402-manifest.json`
- `seller-hardening/openapi.json`
- `seller-hardening/skill.md`
- `seller-hardening/security.txt`
- `seller-hardening/post-deploy-check.mjs`

Latest completed tests:

- `PA_ENTITY_HARDENED_CORE_TESTS=PASS`
- `PA_ENTITY_CONTRACT_TESTS=PASS`

## Apply order

1. Read the current Floot project files again after the quota reset. Do not rely on stale snippets.
2. Patch `endpoints/pa-business_GET.ts` in place using the tested core semantics:
   - challenge before validation for a completely unpaid request;
   - payment-header size/decode validation;
   - strict query + integer limit validation after a payment header is supplied;
   - parse PayAI verify/settle JSON even on non-2xx;
   - require `isValid === true`, never generic `success:true`;
   - treat `settlement_pending` and `duplicate_settlement` as same-payment retry states;
   - never emit a fresh 402 for an unresolved settlement;
   - use abort timeouts;
   - starts-with entity search first;
   - contains fallback only when needed;
   - creation-date + county-code enrichment;
   - one batched principal/officer lookup;
   - exact-duplicate principal removal;
   - real Bazaar example.
3. Update endpoint schema without removing existing response fields.
4. Replace `static/openapi.json` with `seller-hardening/openapi.json`.
5. Publish the canonical v2 manifest at:
   - `/.well-known/x402`
   - `/.well-known/x402.json`
   - `/.well-known/x402-services.json`
   Floot may require an endpoint for the extensionless path; confirm supported routing after reading the project/guides.
6. Fix `/skill.md` so the live response is raw Markdown, not SPA HTML.
7. Add `/.well-known/security.txt`.
8. Add CORS headers to 402 and success/error responses:
   - allow GET/OPTIONS;
   - allow PAYMENT-SIGNATURE and X-PAYMENT;
   - expose PAYMENT-REQUIRED and PAYMENT-RESPONSE.
9. Do **not** add an A2A Agent Card unless an actual A2A endpoint is implemented.
10. Typecheck before publishing.
11. Publish once.
12. Run `seller-hardening/post-deploy-check.mjs` externally.
13. Re-run:
   - Coinbase/CDP x402 validator;
   - AgentCash discovery/check;
   - Agent402 registration/readback;
   - x402scan refresh;
   - nohumans readback;
   - 402 Index readback;
   - PayAI Bazaar resource stats.
14. Only after all gates are green, update public docs/listings.
15. Revenue remains separate: do not count discovery or validation as buyer revenue.

## Payment-state response policy

### Invalid authorization
Return 402 with the specific verification reason and the original payment requirements.

### Facilitator unavailable
Return 503 without a fresh PAYMENT-REQUIRED instruction.

### settlement_pending / duplicate_settlement
Return a retryable non-402 response, e.g. 503 with:
- `Retry-After`
- `x402-settlement-status: pending`
- body instruction to retry the same PAYMENT-SIGNATURE

Do not tell the buyer to create a new authorization.

### Hard settlement failure
Return 402 only when a new authorization is actually required.

### Settled
Return the paid resource plus:
- `PAYMENT-RESPONSE`
- `x402-settled: true`
