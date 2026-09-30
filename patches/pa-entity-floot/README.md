# PA Entity Lookup x402 production repair

This directory is the pre-deploy repair harness for the live Floot seller.

## Required production changes

1. PayAI verify:
   - parse JSON even on HTTP 400;
   - only `isValid === true` is valid;
   - `isValid === false` returns a fresh 402 with the reason;
   - 429/5xx/network/malformed facilitator responses return 503 and never impersonate an invalid payment.

2. PayAI settle:
   - `success === true` is terminal success;
   - `settlement_pending` and `duplicate_settlement` are unresolved;
   - retry the identical settle body with bounded backoff and an idempotency key;
   - if still unresolved, return 503 + Retry-After with NO PAYMENT-REQUIRED header so the buyer retries the same signed payment;
   - only a known terminal payment failure may request a fresh authorization.

3. Request validation:
   - unpaid requests still get the 402 challenge first;
   - after a PAYMENT-SIGNATURE exists, normalize/validate q and limit before calling PayAI;
   - q maximum 200 chars;
   - reject wildcard-only q after normalization;
   - limit must be a strict integer 1-25, not parseInt-style partial input.

4. Discovery:
   - serve the validated root `x402-manifest.json` at:
     - `/.well-known/x402`
     - `/.well-known/x402.json`
     - `/.well-known/x402-services.json`
   - the aliases must return 200 application/json, never S3 403;
   - fix /skill.md or stop advertising it; preferred fallback is to point the catalog skill URL to /llms.txt until Floot can serve Markdown reliably;
   - add x402Version:2/protocolVersion:2 to the legacy x402-service.json without deleting its true402-compatible manifest-version field.

5. CORS:
   - OPTIONS 204;
   - allow GET, OPTIONS;
   - allow PAYMENT-SIGNATURE, X-PAYMENT, Content-Type;
   - expose PAYMENT-REQUIRED and PAYMENT-RESPONSE;
   - apply headers to 402, 200 and retryable 503 responses.

6. Search/value:
   - starts-with business_name search first;
   - contains search only as fallback;
   - preserve normalized legal-name ranking;
   - use full PA current-business dataset for creationDate/countyCode;
   - batch officer lookup by selected filing numbers;
   - preserve all existing response fields.

7. Network safety:
   - add finite fetch timeouts to PayAI and data.pa.gov;
   - fail closed;
   - never settle when primary registry lookup failed.

## Mandatory post-deploy gates

- unpaid live route returns 402 + PAYMENT-REQUIRED;
- malformed payment returns clean invalid-payment 402, not 503;
- settlement_pending never produces a new 402;
- all three canonical manifest paths return 200 JSON;
- /skill.md is real text/markdown OR all metadata stops advertising it;
- CDP validation remains valid/accepted;
- AgentCash still sees one $0.005 paid GET route;
- Agent402 no longer reports crawl_failed;
- OpenAI, Sheetz and Wawa rank the intended legal entity first;
- no tested payment-bypass vector returns registry data;
- PayAI stats remain truthful; revenue is counted only when external settlement appears.
