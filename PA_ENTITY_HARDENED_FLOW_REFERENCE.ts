// PA Entity x402 hardened payment-flow reference
//
// This is a release-reference implementation for the next Floot build.
// It is intentionally framework-agnostic TypeScript pseudocode and records
// the control-flow invariants verified by the red-team pass.

type Json = Record<string, unknown>;

class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const VERIFY_TIMEOUT_MS = 5_000;
const SETTLE_TIMEOUT_MS = 8_000;
const PA_TIMEOUT_MS = 8_000;
const MAX_QUERY_CHARS = 120;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function facilitatorJson(
  facilitator: string,
  path: 'verify' | 'settle',
  body: Json,
  timeoutMs: number
): Promise<{ status: number; ok: boolean; body: Json }> {
  let response: Response;
  try {
    response = await fetchWithTimeout(
      facilitator + '/' + path,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      timeoutMs
    );
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'AbortError';
    throw new HttpError(
      503,
      timeout ? 'facilitator_timeout' : 'facilitator_unreachable',
      timeout ? 'Payment facilitator timed out.' : 'Payment facilitator is unavailable.'
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new HttpError(
      503,
      'facilitator_invalid_response',
      'Payment facilitator returned a non-JSON response.'
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(
      503,
      'facilitator_invalid_response',
      'Payment facilitator returned an invalid JSON shape.'
    );
  }

  return { status: response.status, ok: response.ok, body: parsed as Json };
}

function normalizeQuery(raw: string) {
  const normalized = raw
    .normalize('NFKC')
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (normalized.length < 2) {
    throw new HttpError(400, 'invalid_query', 'q must contain at least 2 useful characters.');
  }
  if (normalized.length > MAX_QUERY_CHARS) {
    throw new HttpError(400, 'query_too_long', `q must be at most ${MAX_QUERY_CHARS} characters.`);
  }
  if (!/[\p{L}\p{N}]/u.test(normalized)) {
    throw new HttpError(400, 'invalid_query', 'q must contain at least one letter or number.');
  }

  return normalized;
}

function parseLimit(raw: string | undefined) {
  if (raw == null || raw === '') return 10;
  if (!/^[0-9]+$/.test(raw)) {
    throw new HttpError(400, 'invalid_limit', 'limit must be an integer from 1 to 25.');
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 25) {
    throw new HttpError(400, 'invalid_limit', 'limit must be an integer from 1 to 25.');
  }
  return value;
}

async function verifyPayment(args: {
  facilitator: string;
  paymentPayload: Json;
  requirements: Json;
}) {
  const result = await facilitatorJson(
    args.facilitator,
    'verify',
    {
      x402Version: 2,
      paymentPayload: args.paymentPayload,
      paymentRequirements: args.requirements,
    },
    VERIFY_TIMEOUT_MS
  );

  // IMPORTANT:
  // Parse invalid-payment JSON even when facilitator HTTP status is 400.
  // Never accept a generic success=true as sufficient proof of validity.
  if (result.body.isValid !== true) {
    const reason =
      String(
        result.body.invalidReason ??
          result.body.errorReason ??
          result.body.error ??
          'payment_verification_failed'
      );
    throw new HttpError(402, reason, 'Payment verification failed.', result.body);
  }

  return result.body;
}

async function settlePayment(args: {
  facilitator: string;
  paymentPayload: Json;
  requirements: Json;
}) {
  const result = await facilitatorJson(
    args.facilitator,
    'settle',
    {
      x402Version: 2,
      paymentPayload: args.paymentPayload,
      paymentRequirements: args.requirements,
    },
    SETTLE_TIMEOUT_MS
  );

  if (result.body.success === true) return result.body;

  const state = String(
    result.body.errorReason ??
      result.body.invalidReason ??
      result.body.status ??
      result.body.error ??
      'payment_settlement_failed'
  );

  // IMPORTANT:
  // An unresolved settlement is not a fresh-payment event.
  // Do not return another x402 402 challenge for these states.
  if (
    /pending|processing|submitted|unknown|timeout|temporar/i.test(state)
  ) {
    throw new HttpError(
      503,
      'settlement_pending',
      'Payment settlement is unresolved. Retry the same request/payment; do not create a new payment.',
      result.body
    );
  }

  // A hard settlement rejection is also not an invitation to blindly generate
  // a second authorization unless the facilitator explicitly says the payment
  // was never usable.
  throw new HttpError(
    409,
    'payment_settlement_failed',
    'Payment settlement failed.',
    result.body
  );
}

async function paidLookupFlow(args: {
  rawQuery: string;
  rawLimit?: string;
  paymentPayload: Json;
  requirements: Json;
  facilitator: string;
  search: (q: string, limit: number, timeoutMs: number) => Promise<unknown>;
}) {
  // Validate BEFORE verifier/upstream calls once a payment header exists.
  const q = normalizeQuery(args.rawQuery);
  const limit = parseLimit(args.rawLimit);

  await verifyPayment({
    facilitator: args.facilitator,
    paymentPayload: args.paymentPayload,
    requirements: args.requirements,
  });

  let data: unknown;
  try {
    data = await args.search(q, limit, PA_TIMEOUT_MS);
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'AbortError';
    throw new HttpError(
      502,
      timeout ? 'pa_source_timeout' : 'pa_source_unavailable',
      'Pennsylvania public-data source is unavailable; payment was not settled.'
    );
  }

  const settlement = await settlePayment({
    facilitator: args.facilitator,
    paymentPayload: args.paymentPayload,
    requirements: args.requirements,
  });

  return {
    data,
    settlement,
  };
}

/*
CORS response contract for browser-capable x402 buyers:

Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: PAYMENT-SIGNATURE, X-PAYMENT, Content-Type
Access-Control-Expose-Headers:
  PAYMENT-REQUIRED,
  PAYMENT-RESPONSE,
  x402-settled,
  x402-price,
  x402-network,
  x402-asset,
  x402-pay-to

Discovery invariants:
- /.well-known/x402 => 200 application/json
- /.well-known/x402.json => exact alias
- /.well-known/x402-services.json => exact alias
- /skill.md => actual Markdown, never SPA shell
- Bazaar example => a real successful representative result
*/
