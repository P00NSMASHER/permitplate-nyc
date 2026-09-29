const PAY_TO = '0xCAbE50F47B12F2dc77eC46a4b69C5085bE156B7f';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT = '5000';
const PRICE = '0.005000';
const FACILITATOR = 'https://facilitator.payai.network';

function encodeBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function decodeBase64Json(value: string): unknown {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

function paymentRequirements() {
  return {
    scheme: 'exact',
    network: NETWORK,
    amount: AMOUNT,
    asset: USDC,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { name: 'USD Coin', version: '2' },
  };
}

function bazaarExtension() {
  const info = {
    input: {
      type: 'http',
      method: 'GET',
      queryParams: { q: 'OpenAI', limit: 5 },
    },
    output: {
      type: 'json',
      example: {
        query: 'OpenAI',
        count: 0,
        results: [],
        source: 'Pennsylvania Department of State via data.pa.gov',
        paid: true,
      },
    },
  };

  const schema = {
    type: 'object',
    properties: {
      input: {
        type: 'object',
        properties: {
          type: { const: 'http' },
          method: { const: 'GET' },
          queryParams: {
            type: 'object',
            properties: {
              q: { type: 'string', minLength: 2 },
              limit: { type: 'integer', minimum: 1, maximum: 25 },
            },
            required: ['q'],
            additionalProperties: false,
          },
        },
        required: ['type', 'method', 'queryParams'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: {
          type: { const: 'json' },
          example: { type: 'object' },
        },
        required: ['type', 'example'],
        additionalProperties: false,
      },
    },
    required: ['input', 'output'],
    additionalProperties: false,
  };

  return { bazaar: { info, schema } };
}

function paymentRequired(resourceUrl: string, reason = 'payment_required') {
  const body = {
    x402Version: 2,
    error: reason,
    resource: {
      url: resourceUrl,
      description:
        'Search Pennsylvania registered business entities by name and receive filing number, registration type, address, city, ZIP, and county.',
      mimeType: 'application/json',
    },
    accepts: [paymentRequirements()],
    extensions: bazaarExtension(),
  };

  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'PAYMENT-REQUIRED': encodeBase64(body),
    },
  });
}

async function facilitatorPost(path: 'verify' | 'settle', paymentPayload: unknown) {
  const response = await fetch(`${FACILITATOR}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: paymentRequirements(),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status}`);
  }
  return body as Record<string, unknown>;
}

async function searchPennsylvania(query: string, limit: number) {
  const url = new URL('https://data.pa.gov/resource/3urc-uaba.json');
  url.searchParams.set('$q', query);
  url.searchParams.set('$limit', String(limit));

  const response = await fetch(url, {
    headers: { 'user-agent': 'PA-Entity-x402/1.0' },
  });
  if (!response.ok) throw new Error(`PA Open Data returned ${response.status}`);

  const rows = (await response.json()) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    businessName: row.business_name ?? null,
    filingNumber: row.filing_number ?? null,
    registrationType: row.typeofbusinessregistration ?? null,
    address1: row.address_line1 ?? null,
    address2: row.address_line2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    zip: row.zip ?? null,
    county: row.shortcountyname ?? null,
  }));
}

export default async (req: Request) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json', allow: 'GET' },
    });
  }

  const requestUrl = new URL(req.url);
  const resourceUrl = `${requestUrl.origin}/api/pa-entity`;
  const paymentHeader =
    req.headers.get('PAYMENT-SIGNATURE') ?? req.headers.get('X-PAYMENT');

  if (!paymentHeader) return paymentRequired(resourceUrl);

  let paymentPayload: unknown;
  try {
    paymentPayload = decodeBase64Json(paymentHeader);
  } catch {
    return paymentRequired(resourceUrl, 'invalid_payment_header');
  }

  const query = (requestUrl.searchParams.get('q') ?? '').trim();
  if (query.length < 2) {
    return new Response(JSON.stringify({ error: 'q must contain at least 2 characters' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const parsedLimit = Number.parseInt(requestUrl.searchParams.get('limit') ?? '10', 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 25))
    : 10;

  let verified: Record<string, unknown>;
  try {
    verified = await facilitatorPost('verify', paymentPayload);
  } catch {
    return new Response(JSON.stringify({ error: 'payment_verifier_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (verified.isValid !== true) {
    return paymentRequired(
      resourceUrl,
      String(verified.invalidReason ?? 'payment_verification_failed')
    );
  }

  let results;
  try {
    results = await searchPennsylvania(query, limit);
  } catch {
    return new Response(
      JSON.stringify({
        error: 'pa_registry_unavailable',
        message: 'Payment was verified but not settled.',
      }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    );
  }

  let settled: Record<string, unknown>;
  try {
    settled = await facilitatorPost('settle', paymentPayload);
  } catch {
    return new Response(JSON.stringify({ error: 'payment_settlement_unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (settled.success !== true) {
    return paymentRequired(
      resourceUrl,
      String(settled.errorReason ?? 'payment_settlement_failed')
    );
  }

  return new Response(
    JSON.stringify({
      query,
      count: results.length,
      results,
      source: 'Pennsylvania Department of State via data.pa.gov',
      paid: true,
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'PAYMENT-RESPONSE': encodeBase64(settled),
      },
    }
  );
};

export const config = {
  path: '/api/pa-entity',
};
