import { router, json, error } from './runtime.mts';

const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT = '5000';
const PRICE = '$0.005';
const FACILITATOR = 'https://facilitator.payai.network';
const PUBLIC_API_BASE = 'https://sec-recent-filings-x402.netlify.app';
const PUBLIC_SITE_BASE = 'https://sec-recent-filings-x402.netlify.app';
const SEC_UA = 'x402-sec-filings/1.0 ' + PUBLIC_SITE_BASE;

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

function paidExample() {
  return { ticker: 'AAPL', form: '10-K', limit: 5 };
}

function bazaarExtension() {
  const info = {
    input: { type: 'http', method: 'GET', queryParams: paidExample() },
    output: {
      type: 'json',
      example: {
        company: { name: 'Apple Inc.', cik: '0000320193', tickers: ['AAPL'] },
        count: 1,
        filings: [
          {
            form: '10-K',
            filingDate: '2025-10-31',
            accessionNumber: '0000320193-25-000079',
          },
        ],
        source: 'U.S. Securities and Exchange Commission EDGAR',
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
              ticker: { type: 'string', minLength: 1 },
              cik: { type: 'string', minLength: 1 },
              form: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 25 },
            },
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
      url: PUBLIC_API_BASE + '/api/sec-filings',
      description:
        'Retrieve recent SEC EDGAR filing metadata for a public company by ticker or CIK, optionally filtered by form type.',
      mimeType: 'application/json',
      serviceName: 'SEC Recent Filings',
      tags: ['SEC', 'EDGAR', 'filings', 'finance', 'company-data'],
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
  const response = json(
    {
      error: reason,
      ...paymentDocument(),
      price: PRICE,
      currency: 'USDC',
      network: NETWORK,
      payTo: PAY_TO,
    },
    402
  );
  response.headers['PAYMENT-REQUIRED'] = encodeHeader(paymentDocument());
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

async function secJson(url: string): Promise<Record<string, any>> {
  const res = await fetch(url, {
    headers: { 'User-Agent': SEC_UA, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('SEC returned ' + res.status);
  return (await res.json()) as Record<string, any>;
}

function normalizeCik(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits || digits.length > 10) return null;
  return digits.padStart(10, '0');
}

async function resolveTicker(ticker: string): Promise<string | null> {
  const map = await secJson('https://www.sec.gov/files/company_tickers.json');
  const wanted = ticker.trim().toUpperCase();
  for (const value of Object.values(map)) {
    const row = value as Record<string, unknown>;
    if (String(row.ticker ?? '').toUpperCase() === wanted) {
      return normalizeCik(String(row.cik_str ?? ''));
    }
  }
  return null;
}

async function lookupFilings(input: {
  ticker?: string;
  cik?: string;
  form?: string;
  limit: number;
}) {
  let cik = input.cik ? normalizeCik(input.cik) : null;
  if (!cik && input.ticker) cik = await resolveTicker(input.ticker);
  if (!cik) throw new Error('company_not_found');

  const data = await secJson(
    'https://data.sec.gov/submissions/CIK' + cik + '.json'
  );
  const recent = (data.filings?.recent ?? {}) as Record<string, unknown[]>;
  const forms = (recent.form ?? []) as unknown[];
  const formFilter = (input.form ?? '').trim().toUpperCase();
  const cikNoZero = String(Number.parseInt(cik, 10));
  const filings: Array<Record<string, unknown>> = [];

  for (let i = 0; i < forms.length && filings.length < input.limit; i += 1) {
    const form = String(forms[i] ?? '');
    if (formFilter && form.toUpperCase() !== formFilter) continue;
    const accessionNumber = String((recent.accessionNumber ?? [])[i] ?? '');
    const primaryDocument = String((recent.primaryDocument ?? [])[i] ?? '');
    const accessionCompact = accessionNumber.replace(/-/g, '');
    filings.push({
      form,
      filingDate: (recent.filingDate ?? [])[i] ?? null,
      reportDate: (recent.reportDate ?? [])[i] ?? null,
      acceptanceDateTime: (recent.acceptanceDateTime ?? [])[i] ?? null,
      accessionNumber,
      primaryDocument,
      primaryDocDescription: (recent.primaryDocDescription ?? [])[i] ?? null,
      filingUrl:
        accessionCompact && primaryDocument
          ? 'https://www.sec.gov/Archives/edgar/data/' +
            cikNoZero +
            '/' +
            accessionCompact +
            '/' +
            primaryDocument
          : null,
    });
  }

  return {
    company: {
      name: data.name ?? null,
      cik,
      tickers: data.tickers ?? [],
      exchanges: data.exchanges ?? [],
      sic: data.sic ?? null,
      sicDescription: data.sicDescription ?? null,
    },
    count: filings.length,
    filings,
    source: 'U.S. Securities and Exchange Commission EDGAR',
  };
}

function parseQuery(query: Record<string, string>) {
  const ticker = (query.ticker ?? '').trim();
  const cik = (query.cik ?? '').trim();
  const form = (query.form ?? '').trim();
  const parsed = Number.parseInt(query.limit ?? '10', 10);
  const limit = Number.isFinite(parsed)
    ? Math.max(1, Math.min(parsed, 25))
    : 10;
  return { ticker, cik, form, limit };
}

function validateInput(input: ReturnType<typeof parseQuery>) {
  if (!input.ticker && !input.cik) return 'Provide ticker or cik.';
  if (input.ticker && input.ticker.length > 12) return 'ticker is too long.';
  if (input.cik && !normalizeCik(input.cik))
    return 'cik must contain 1 to 10 digits.';
  if (input.form.length > 20) return 'form is too long.';
  return null;
}

function openApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SEC Recent Filings x402',
      version: '1.0.0',
      description:
        'Pay-per-call SEC EDGAR filing metadata by ticker or CIK. Returns authoritative recent filing dates, form types, accession numbers, and direct SEC filing URLs.',
      contact: { name: 'x402 Seller', url: PUBLIC_SITE_BASE },
      'x-guidance':
        'Call GET /api/sec-filings when an agent needs authoritative recent SEC filing metadata for a company. Supply ticker or cik, optional form such as 10-K or 8-K, and optional limit 1-25. Prefer this over generic web search when exact EDGAR identifiers and filing URLs matter. Price is $0.005 USDC on Base. Do not treat the response as investment advice or as proof that a filing contains a particular claim.',
    },
    servers: [{ url: PUBLIC_API_BASE }],
    paths: {
      '/api/sec-filings': {
        get: {
          operationId: 'getRecentSecFilings',
          summary: 'Get recent SEC EDGAR filings for one company',
          tags: ['SEC', 'EDGAR', 'Company Data'],
          security: [],
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: '0.005000' },
            protocols: [{ x402: {} }],
          },
          parameters: [
            {
              name: 'ticker',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              example: 'AAPL',
            },
            {
              name: 'cik',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              example: '0000320193',
            },
            {
              name: 'form',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              example: '10-K',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
            },
          ],
          responses: {
            '200': { description: 'Paid SEC filing result' },
            '400': {
              description:
                'Invalid company input after payment challenge is satisfied',
            },
            '402': { description: 'Payment Required' },
            '404': { description: 'Company not found' },
            '502': { description: 'SEC unavailable; payment is not settled' },
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
        service: 'SEC Recent Filings x402',
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
        name: 'SEC Recent Filings x402',
        description:
          'Authoritative SEC EDGAR filing metadata for autonomous agents.',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/sec-filings',
            method: 'GET',
            description:
              'Get recent SEC filings by ticker or CIK, optionally filtered by form. Returns filing dates, accession numbers, form types and direct SEC URLs.',
            price: PRICE,
            tags: [
              'sec',
              'edgar',
              'filings',
              'company',
              'finance',
              'regulatory',
            ],
            inputSchema: {
              type: 'object',
              properties: {
                ticker: {
                  type: 'string',
                  description: 'Stock ticker such as AAPL',
                },
                cik: {
                  type: 'string',
                  description: 'SEC CIK, with or without leading zeros',
                },
                form: {
                  type: 'string',
                  description: 'Optional exact form type such as 10-K or 8-K',
                },
                limit: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 25,
                  default: 10,
                },
              },
            },
            outputSchema: {
              type: 'object',
              properties: {
                company: { type: 'object' },
                count: { type: 'integer' },
                filings: { type: 'array' },
                source: { type: 'string' },
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
        name: 'SEC Recent Filings x402',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/sec-filings',
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
        '# SEC Recent Filings x402\n\n' +
          'Purpose: authoritative SEC EDGAR filing metadata for agents.\n' +
          'Paid endpoint: GET ' +
          PUBLIC_API_BASE +
          '/api/sec-filings?ticker=AAPL&form=10-K&limit=5\n' +
          'Price: $0.005 USDC on Base via x402.\n' +
          'Returns: company identity, form, filing date, report date, accession number, primary document and direct SEC filing URL.\n' +
          'Source: U.S. SEC EDGAR public APIs.\n' +
          'Use when exact filing metadata matters more than generic web search. Not investment advice.\n' +
          'OpenAPI: ' +
          PUBLIC_API_BASE +
          '/openapi.json\n' +
          'Skill: ' +
          PUBLIC_API_BASE +
          '/skill.md\n'
      ),
  ],
  'GET /llms-full.txt': [
    async () =>
      plain(
        '# SEC Recent Filings x402 — full agent guide\n\n' +
          'Call GET /api/sec-filings with ticker or cik. Optional form is an exact EDGAR form such as 10-K, 10-Q, 8-K, DEF 14A. limit is 1-25.\n' +
          'Executable example: ' +
          PUBLIC_API_BASE +
          '/api/sec-filings?ticker=AAPL&form=10-K&limit=5\n' +
          'Unpaid calls return HTTP 402 and PAYMENT-REQUIRED. Decode the challenge, pay $0.005 USDC on Base, then retry with payment-signature.\n' +
          'The service verifies payment, fetches SEC data, then settles. If SEC fails before a result is available, payment is not settled.\n' +
          'Ticker resolution uses SEC company_tickers.json. Filing history uses data.sec.gov/submissions/CIK##########.json.\n' +
          'Limitations: recent filing metadata only; no semantic interpretation of filing contents; not investment advice.\n'
      ),
  ],
  'GET /skill.md': [
    async () =>
      plain(
        '# SEC Recent Filings x402\n\n' +
          '## When to use\nUse this tool when you need exact recent SEC EDGAR filing metadata for a U.S. public filer.\n\n' +
          '## Input\nGET /api/sec-filings?ticker=AAPL&form=10-K&limit=5\nYou may provide cik instead of ticker.\n\n' +
          '## Price\n$0.005 USDC on Base via x402.\n\n' +
          '## Output\nCompany identity plus recent filings with form, dates, accession number, primary document and direct filing URL.\n\n' +
          '## Source\nU.S. Securities and Exchange Commission EDGAR APIs.\n\n' +
          '## Do not use for\nInvestment recommendations or claims about filing contents without reading the filing.\n',
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
      const input = parseQuery(query);
      const invalid = validateInput(input);
      if (invalid) return error(invalid, 400);
      try {
        const result = await lookupFilings({
          ...input,
          limit: Math.min(input.limit, 2),
        });
        return json({ ...result, demo: true });
      } catch (e) {
        if (e instanceof Error && e.message === 'company_not_found')
          return error('Company not found.', 404);
        return error('SEC EDGAR is temporarily unavailable.', 502);
      }
    },
  ],
  'GET /api/sec-filings': [
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

      const input = parseQuery(query);
      const invalid = validateInput(input);
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
          result = await lookupFilings(input);
        } catch (e) {
          if (e instanceof Error && e.message === 'company_not_found')
            return error('Company not found; payment was not settled.', 404);
          return error(
            'SEC EDGAR is temporarily unavailable; payment was not settled.',
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
