import { router, json, error } from './runtime.mts';

const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT = '5000';
const PRICE = '$0.005';
const FACILITATOR = 'https://facilitator.payai.network';
const PUBLIC_API_BASE = 'https://treasury-average-interest-rates-x402.netlify.app';
const PUBLIC_SITE_BASE = 'https://treasury-average-interest-rates-x402.netlify.app';
const TREASURY_API =
  'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates';

function header(
  event: Record<string, unknown>,
  name: string
): string | undefined {
  const headers = (event.headers ?? {}) as Record<string, unknown>;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value !== undefined && value !== null)
      return String(value);
  }
  return undefined;
}

function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function decodePayment(value: string): unknown {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

function requirements() {
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
      queryParams: { security: 'Total Marketable' },
    },
    output: {
      type: 'json',
      example: {
        recordDate: '2026-08-31',
        count: 1,
        rates: [
          {
            securityDescription: 'Total Marketable',
            securityType: 'Marketable',
            averageInterestRatePercent: 3.5,
          },
        ],
        source: 'U.S. Treasury Fiscal Data',
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
            properties: { security: { type: 'string', maxLength: 100 } },
            additionalProperties: false,
          },
        },
        required: ['type', 'method', 'queryParams'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: { type: { const: 'json' }, example: { type: 'object' } },
        required: ['type', 'example'],
        additionalProperties: false,
      },
    },
    required: ['input', 'output'],
    additionalProperties: false,
  };
  return { bazaar: { info, schema } };
}

function paymentDocument() {
  return {
    x402Version: 2,
    resource: {
      url: PUBLIC_API_BASE + '/api/treasury-average-rates',
      description:
        'Get the latest monthly average interest rates paid on outstanding U.S. Treasury securities, optionally filtered by security description.',
      mimeType: 'application/json',
    },
    accepts: [requirements()],
    extensions: bazaarExtension(),
  };
}

function withHeaders(
  response: ReturnType<typeof json>,
  headers: Record<string, string>
) {
  Object.assign(response.headers, headers);
  return response;
}

function paymentRequired(reason = 'payment_required') {
  const doc = paymentDocument();
  const response = json(
    {
      error: reason,
      ...doc,
      price: PRICE,
      currency: 'USDC',
      network: NETWORK,
      payTo: PAY_TO,
    },
    402
  );
  response.headers['PAYMENT-REQUIRED'] = encodeHeader(doc);
  response.headers['x402-price'] = PRICE;
  response.headers['x402-asset'] = 'USDC';
  response.headers['x402-network'] = NETWORK;
  response.headers['x402-pay-to'] = PAY_TO;
  return response;
}

function plain(
  body: string,
  contentType = 'text/plain; charset=utf-8',
  statusCode = 200
) {
  return {
    statusCode,
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=300',
    },
    body,
  };
}

async function facilitatorPost(
  path: 'verify' | 'settle',
  paymentPayload: unknown
) {
  const res = await fetch(FACILITATOR + '/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload,
      paymentRequirements: requirements(),
    }),
  });
  if (!res.ok)
    throw new Error('facilitator ' + path + ' returned ' + res.status);
  return (await res.json()) as Record<string, unknown>;
}

async function latestRates(security: string) {
  const url = new URL(TREASURY_API);
  url.searchParams.set(
    'fields',
    'record_date,security_type_desc,security_desc,avg_interest_rate_amt'
  );
  url.searchParams.set('sort', '-record_date');
  url.searchParams.set('page[size]', '100');
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'x402-treasury-average-rates/1.0 (' + PUBLIC_SITE_BASE + ')',
    },
  });
  if (!res.ok) throw new Error('Treasury returned ' + res.status);
  const payload = (await res.json()) as {
    data?: Array<Record<string, string>>;
    meta?: Record<string, unknown>;
  };
  const rows = payload.data ?? [];
  if (!rows.length) throw new Error('Treasury returned no data');
  const recordDate = String(rows[0].record_date ?? '');
  const needle = security.trim().toLowerCase();
  const latest = rows.filter(
    row => String(row.record_date ?? '') === recordDate
  );
  const filtered = needle
    ? latest.filter(row =>
        String(row.security_desc ?? '')
          .toLowerCase()
          .includes(needle)
      )
    : latest;
  return {
    recordDate,
    count: filtered.length,
    rates: filtered.map(row => ({
      securityDescription: row.security_desc ?? null,
      securityType: row.security_type_desc ?? null,
      averageInterestRatePercent:
        row.avg_interest_rate_amt === '' || row.avg_interest_rate_amt == null
          ? null
          : Number(row.avg_interest_rate_amt),
    })),
    source:
      'U.S. Treasury Fiscal Data — Average Interest Rates on U.S. Treasury Securities',
    frequency: 'monthly',
  };
}

function validateSecurity(value: string) {
  if (value.length > 100)
    return 'security filter must be 100 characters or fewer.';
  return null;
}

function openApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Treasury Average Interest Rates x402',
      version: '1.0.0',
      description:
        'Pay-per-call latest monthly average interest rates on outstanding U.S. Treasury securities from the official Bureau of the Fiscal Service dataset.',
      contact: { name: 'x402 Seller', url: PUBLIC_SITE_BASE },
      'x-guidance':
        'Call GET /api/treasury-average-rates when an agent needs the latest weighted average interest rate Treasury pays on outstanding securities such as Bills, Notes, Bonds, TIPS, FRNs, Total Marketable, or Total Interest-bearing Debt. Optional security performs a case-insensitive description filter. Price is $0.005 USDC on Base. These are monthly average rates on outstanding debt, not live market yields.',
    },
    servers: [{ url: PUBLIC_API_BASE }],
    paths: {
      '/api/treasury-average-rates': {
        get: {
          operationId: 'getTreasuryAverageInterestRates',
          summary:
            'Get latest average interest rates on U.S. Treasury securities',
          tags: ['Treasury', 'Interest Rates', 'Macro'],
          security: [],
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: '0.005000' },
            protocols: [{ x402: {} }],
          },
          parameters: [
            {
              name: 'security',
              in: 'query',
              required: false,
              schema: { type: 'string', maxLength: 100 },
              example: 'Total Marketable',
            },
          ],
          responses: {
            '200': { description: 'Paid latest Treasury average-rate result' },
            '400': { description: 'Invalid filter input' },
            '402': { description: 'Payment Required' },
            '502': {
              description:
                'Treasury Fiscal Data unavailable; payment is not settled',
            },
            '503': { description: 'Payment facilitator unavailable' },
          },
        },
      },
    },
  };
}

export const handler = router({
  'GET /api/_healthcheck': [async () => json({ message: 'Success' })],
  'GET /api/health': [
    async () =>
      json({
        ok: true,
        service: 'Treasury Average Interest Rates x402',
        price: PRICE,
        network: NETWORK,
      }),
  ],
  'GET /api/payment-info': [
    async () =>
      json({
        price: PRICE,
        amountAtomic: AMOUNT,
        asset: USDC,
        network: NETWORK,
        payTo: PAY_TO,
        facilitator: FACILITATOR,
      }),
  ],
  'GET /.well-known/x402': [
    async () =>
      json({
        x402Version: 2,
        name: 'Treasury Average Interest Rates x402',
        description:
          'Latest monthly U.S. Treasury average interest rates for autonomous agents.',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/treasury-average-rates',
            method: 'GET',
            description:
              'Return latest monthly average interest rates on outstanding Treasury securities, optionally filtered by security class.',
            price: PRICE,
            tags: [
              'treasury',
              'interest-rates',
              'macro',
              'government-data',
              'bonds',
              'debt',
            ],
            inputSchema: {
              type: 'object',
              properties: {
                security: {
                  type: 'string',
                  maxLength: 100,
                  description:
                    'Optional security description filter such as Total Marketable or Treasury Bills',
                },
              },
            },
            outputSchema: {
              type: 'object',
              properties: {
                recordDate: { type: 'string' },
                count: { type: 'integer' },
                rates: { type: 'array' },
                source: { type: 'string' },
                frequency: { type: 'string' },
                paid: { type: 'boolean' },
              },
            },
            accepts: [requirements()],
          },
        ],
      }),
  ],
  'GET /.well-known/x402.json': [
    async () =>
      json({
        ...paymentDocument(),
        name: 'Treasury Average Interest Rates x402',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/treasury-average-rates',
            price: PRICE,
            accepts: [requirements()],
          },
        ],
      }),
  ],
  'GET /openapi.json': [async () => json(openApi())],
  'GET /llms.txt': [
    async () =>
      plain(
        '# Treasury Average Interest Rates x402\n\n' +
          'Purpose: latest monthly average interest rates Treasury pays on outstanding securities.\n' +
          'Paid endpoint: GET ' +
          PUBLIC_API_BASE +
          '/api/treasury-average-rates?security=Total%20Marketable\n' +
          'Price: $0.005 USDC on Base via x402.\n' +
          'Returns: record date, security description/type, and weighted average interest rate percent.\n' +
          'Source: U.S. Treasury Bureau of the Fiscal Service, Fiscal Data API.\n' +
          'Important: these are average rates on outstanding debt, not live market yields.\n' +
          'OpenAPI: ' +
          PUBLIC_API_BASE +
          '/openapi.json\nSkill: ' +
          PUBLIC_API_BASE +
          '/skill.md\n'
      ),
  ],
  'GET /llms-full.txt': [
    async () =>
      plain(
        '# Treasury Average Interest Rates x402 — full agent guide\n\n' +
          'Call GET /api/treasury-average-rates with optional security. Example: ?security=Total%20Marketable. Omit security to receive all security classes for the latest available month.\n' +
          'Unpaid calls return HTTP 402 and PAYMENT-REQUIRED. Price is $0.005 USDC on Base.\n' +
          'The service verifies payment, fetches the official Fiscal Data avg_interest_rates endpoint, selects only the newest record_date, then settles. Treasury failure before a result means payment is not settled.\n' +
          'Use for federal borrowing-cost context. Do not confuse these monthly weighted averages on outstanding debt with current Treasury market yields.\n'
      ),
  ],
  'GET /skill.md': [
    async () =>
      plain(
        '# Treasury Average Interest Rates x402\n\n## When to use\nUse for the latest monthly weighted average rates on outstanding U.S. Treasury Bills, Notes, Bonds, TIPS, FRNs, and aggregate debt categories.\n\n## Input\nGET /api/treasury-average-rates?security=Total%20Marketable\nThe security filter is optional.\n\n## Price\n$0.005 USDC on Base via x402.\n\n## Source\nU.S. Treasury Fiscal Data API.\n\n## Limitation\nThese are monthly average rates on outstanding debt, not live market yields.\n',
        'text/markdown; charset=utf-8'
      ),
  ],
  'GET /robots.txt': [
    async () =>
      plain(
        'User-agent: *\nAllow: /\nSitemap: ' +
          PUBLIC_API_BASE +
          '/sitemap.xml\n'
      ),
  ],
  'GET /sitemap.xml': [
    async () =>
      plain(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' +
          PUBLIC_SITE_BASE +
          '/</loc></url><url><loc>' +
          PUBLIC_API_BASE +
          '/openapi.json</loc></url><url><loc>' +
          PUBLIC_API_BASE +
          '/llms.txt</loc></url></urlset>',
        'application/xml; charset=utf-8'
      ),
  ],
  'GET /api/demo': [
    async ({ query }) => {
      const security = (query.security ?? '').trim();
      const invalid = validateSecurity(security);
      if (invalid) return error(invalid, 400);
      try {
        const result = await latestRates(security);
        return json({ ...result, demo: true });
      } catch {
        return error(
          'U.S. Treasury Fiscal Data is temporarily unavailable.',
          502
        );
      }
    },
  ],
  'GET /api/treasury-average-rates': [
    async ({ query, event }) => {
      const ev = event as Record<string, unknown>;
      const signature =
        header(ev, 'payment-signature') ?? header(ev, 'x-payment');
      if (!signature) return paymentRequired();

      let paymentPayload: unknown;
      try {
        paymentPayload = decodePayment(signature);
      } catch {
        return paymentRequired('invalid_payment_header');
      }

      const security = (query.security ?? '').trim();
      const invalid = validateSecurity(security);
      if (invalid) return error(invalid, 400);

      try {
        const verified = await facilitatorPost('verify', paymentPayload);
        if (verified.isValid !== true && verified.success !== true) {
          return paymentRequired(
            String(
              verified.invalidReason ??
                verified.errorReason ??
                'payment_verification_failed'
            )
          );
        }

        let result;
        try {
          result = await latestRates(security);
        } catch {
          return error(
            'U.S. Treasury Fiscal Data is temporarily unavailable; payment was not settled.',
            502
          );
        }

        const settled = await facilitatorPost('settle', paymentPayload);
        if (settled.success !== true)
          return paymentRequired(
            String(settled.errorReason ?? 'payment_settlement_failed')
          );

        return withHeaders(json({ ...result, paid: true }), {
          'PAYMENT-RESPONSE': encodeHeader(settled),
          'x402-settled': 'true',
        });
      } catch {
        return error(
          'Payment facilitator is temporarily unavailable; no result was served.',
          503
        );
      }
    },
  ],
});


export default async function netlifySeller(request: Request) {
  return handler(request);
}

export const config = {
  path: [
    '/api/*',
    '/.well-known/*',
    '/openapi.json',
    '/llms.txt',
    '/llms-full.txt',
    '/skill.md',
    '/robots.txt',
    '/sitemap.xml'
  ]
};
