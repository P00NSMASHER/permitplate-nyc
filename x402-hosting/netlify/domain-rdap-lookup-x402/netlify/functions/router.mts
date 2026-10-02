import { router, json, error } from './runtime.mts';

const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT = '5000';
const PRICE = '$0.005';
const FACILITATOR = 'https://facilitator.payai.network';
const PUBLIC_API_BASE = 'https://domain-rdap-lookup-x402.netlify.app';
const PUBLIC_SITE_BASE = 'https://domain-rdap-lookup-x402.netlify.app';
const IANA_RDAP_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';

type Bootstrap = { services?: Array<[string[], string[]]> };

let bootstrapCache: { loadedAt: number; data: Bootstrap } | null = null;

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
      queryParams: { domain: 'example.com' },
    },
    output: {
      type: 'json',
      example: {
        domain: 'example.com',
        registered: true,
        registrar: {
          name: 'RESERVED-Internet Assigned Numbers Authority',
          handle: '...',
        },
        events: {
          registration: '1995-08-14T04:00:00Z',
          expiration: '2027-08-13T04:00:00Z',
        },
        nameservers: ['a.iana-servers.net', 'b.iana-servers.net'],
        source: 'Authoritative RDAP server discovered via IANA bootstrap',
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
              domain: { type: 'string', minLength: 3, maxLength: 253 },
            },
            required: ['domain'],
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
      url: PUBLIC_API_BASE + '/api/domain-rdap',
      description:
        'Retrieve live authoritative domain-registration metadata through RDAP, using IANA bootstrap to locate the correct registry service.',
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

function normalizeDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (value.length < 3 || value.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(value)) return null;
  const labels = value.split('.');
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (
      !label ||
      label.length > 63 ||
      label.startsWith('-') ||
      label.endsWith('-')
    )
      return null;
  }
  return value;
}

async function bootstrap(): Promise<Bootstrap> {
  if (bootstrapCache && Date.now() - bootstrapCache.loadedAt < 60 * 60 * 1000)
    return bootstrapCache.data;
  const res = await fetch(IANA_RDAP_BOOTSTRAP, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'x402-domain-rdap/1.0 (' + PUBLIC_SITE_BASE + ')',
    },
  });
  if (!res.ok) throw new Error('IANA bootstrap returned ' + res.status);
  const data = (await res.json()) as Bootstrap;
  bootstrapCache = { loadedAt: Date.now(), data };
  return data;
}

function findRdapBase(data: Bootstrap, tld: string): string | null {
  for (const service of data.services ?? []) {
    const tlds = service[0] ?? [];
    const urls = service[1] ?? [];
    if (
      tlds.some(value => value.toLowerCase() === tld.toLowerCase()) &&
      urls.length
    )
      return urls[0];
  }
  return null;
}

function vcardName(entity: Record<string, any>): string | null {
  const card = entity.vcardArray;
  if (!Array.isArray(card) || !Array.isArray(card[1])) return null;
  for (const item of card[1]) {
    if (Array.isArray(item) && item[0] === 'fn')
      return String(item[3] ?? '') || null;
  }
  return null;
}

function eventMap(events: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(events)) return out;
  for (const item of events) {
    const e = item as Record<string, unknown>;
    const action = String(e.eventAction ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+(.)/g, (_m, c: string) => c.toUpperCase());
    const date = String(e.eventDate ?? '');
    if (action && date && !out[action]) out[action] = date;
  }
  return out;
}

async function lookupDomain(domain: string) {
  const tld = domain.split('.').pop() ?? '';
  const registry = await bootstrap();
  const base = findRdapBase(registry, tld);
  if (!base) {
    return {
      domain,
      registered: null,
      error: 'no_rdap_bootstrap_service',
      source: 'IANA RDAP Bootstrap Service Registry',
    };
  }

  const url =
    base.replace(/\/+$/, '') + '/domain/' + encodeURIComponent(domain);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/rdap+json, application/json',
      'User-Agent': 'x402-domain-rdap/1.0 (' + PUBLIC_SITE_BASE + ')',
    },
    redirect: 'follow',
  });

  if (res.status === 404) {
    return {
      domain,
      registered: false,
      authoritativeRdap: base,
      source: 'Authoritative RDAP server discovered via IANA bootstrap',
    };
  }
  if (!res.ok) throw new Error('RDAP returned ' + res.status);
  const data = (await res.json()) as Record<string, any>;

  const registrarEntity = Array.isArray(data.entities)
    ? data.entities.find(
        (entity: Record<string, any>) =>
          Array.isArray(entity.roles) &&
          entity.roles
            .map((r: unknown) => String(r).toLowerCase())
            .includes('registrar')
      )
    : undefined;

  const nameservers = Array.isArray(data.nameservers)
    ? data.nameservers
        .map((ns: Record<string, unknown>) =>
          String(ns.ldhName ?? ns.unicodeName ?? '')
        )
        .filter(Boolean)
    : [];

  return {
    domain,
    registered: true,
    handle: data.handle ?? null,
    unicodeName: data.unicodeName ?? null,
    status: Array.isArray(data.status) ? data.status : [],
    registrar: registrarEntity
      ? {
          name: vcardName(registrarEntity),
          handle: registrarEntity.handle ?? null,
        }
      : null,
    events: eventMap(data.events),
    nameservers,
    secureDns: data.secureDNS
      ? { delegationSigned: data.secureDNS.delegationSigned ?? null }
      : null,
    authoritativeRdap: base,
    source: 'Authoritative RDAP server discovered via IANA bootstrap',
  };
}

function openApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Domain RDAP Lookup x402',
      version: '1.0.0',
      description:
        'Pay-per-call live domain registration metadata using IANA RDAP bootstrap and the authoritative TLD registry RDAP service.',
      contact: { name: 'x402 Seller', url: PUBLIC_SITE_BASE },
      'x-guidance':
        'Call GET /api/domain-rdap when an agent needs current domain registration status, registrar, registration/expiration events, nameservers, status codes, or DNSSEC delegation state. Supply an ASCII or punycode domain such as example.com. Price is $0.005 USDC on Base. The service does not return nonpublic registration data and does not infer ownership beyond what the authoritative RDAP response exposes.',
    },
    servers: [{ url: PUBLIC_API_BASE }],
    paths: {
      '/api/domain-rdap': {
        get: {
          operationId: 'lookupDomainRdap',
          summary: 'Get live authoritative RDAP data for one domain',
          tags: ['Domains', 'RDAP', 'Registration Data'],
          security: [],
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: '0.005000' },
            protocols: [{ x402: {} }],
          },
          parameters: [
            {
              name: 'domain',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 3, maxLength: 253 },
              example: 'example.com',
            },
          ],
          responses: {
            '200': { description: 'Paid authoritative RDAP result' },
            '400': { description: 'Invalid domain input' },
            '402': { description: 'Payment Required' },
            '502': {
              description:
                'IANA or authoritative RDAP service unavailable; payment is not settled',
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
        service: 'Domain RDAP Lookup x402',
        price: PRICE,
        network: NETWORK,
        bootstrapCached: Boolean(bootstrapCache),
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
        name: 'Domain RDAP Lookup x402',
        description:
          'Live authoritative domain registration metadata for autonomous agents.',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/domain-rdap',
            method: 'GET',
            description:
              'Resolve a domain through IANA RDAP bootstrap to its authoritative registry and return registration status, registrar, dates, nameservers and DNSSEC state.',
            price: PRICE,
            tags: [
              'domain',
              'rdap',
              'whois',
              'registrar',
              'dns',
              'registration',
            ],
            inputSchema: {
              type: 'object',
              properties: {
                domain: { type: 'string', minLength: 3, maxLength: 253 },
              },
              required: ['domain'],
            },
            outputSchema: {
              type: 'object',
              properties: {
                domain: { type: 'string' },
                registered: { type: ['boolean', 'null'] },
                registrar: { type: ['object', 'null'] },
                events: { type: 'object' },
                nameservers: { type: 'array' },
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
        name: 'Domain RDAP Lookup x402',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/domain-rdap',
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
        '# Domain RDAP Lookup x402\n\n' +
          'Purpose: authoritative live domain registration metadata via RDAP.\n' +
          'Paid endpoint: GET ' +
          PUBLIC_API_BASE +
          '/api/domain-rdap?domain=example.com\n' +
          'Price: $0.005 USDC on Base via x402.\n' +
          'Returns: registered status, registrar, RDAP status, registration/expiration/update events, nameservers, DNSSEC delegation state, and authoritative RDAP base URL.\n' +
          'Source: IANA RDAP bootstrap plus the authoritative registry RDAP server.\n' +
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
        '# Domain RDAP Lookup x402 — full agent guide\n\n' +
          'Call GET /api/domain-rdap?domain=example.com. ASCII and punycode domains are accepted.\n' +
          'Unpaid calls return HTTP 402 and PAYMENT-REQUIRED. Price is $0.005 USDC on Base.\n' +
          'The service verifies payment, fetches IANA dns.json bootstrap data, queries the TLD authoritative RDAP service, then settles. If bootstrap or RDAP fails before a valid result, payment is not settled.\n' +
          'A 404 from the authoritative RDAP service is returned as registered=false.\n' +
          'Limitations: no nonpublic registration data; no inferred ownership; RDAP availability and redaction policies vary by registry.\n'
      ),
  ],
  'GET /skill.md': [
    async () =>
      plain(
        '# Domain RDAP Lookup x402\n\n## When to use\nUse when an agent needs current domain registration facts from the authoritative RDAP service rather than guessed or cached WHOIS text.\n\n## Input\nGET /api/domain-rdap?domain=example.com\n\n## Price\n$0.005 USDC on Base via x402.\n\n## Output\nRegistration status, registrar, events, nameservers, DNSSEC delegation state and authoritative RDAP URL.\n\n## Sources\nIANA RDAP bootstrap plus authoritative registry RDAP.\n',
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
      const domain = normalizeDomain(query.domain ?? '');
      if (!domain)
        return error(
          'domain must be a valid ASCII or punycode domain name.',
          400
        );
      try {
        const result = await lookupDomain(domain);
        return json({ ...result, demo: true });
      } catch {
        return error(
          'IANA or the authoritative RDAP service is temporarily unavailable.',
          502
        );
      }
    },
  ],
  'GET /api/domain-rdap': [
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

      const domain = normalizeDomain(query.domain ?? '');
      if (!domain)
        return error(
          'domain must be a valid ASCII or punycode domain name.',
          400
        );

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
          result = await lookupDomain(domain);
        } catch {
          return error(
            'IANA or the authoritative RDAP service is temporarily unavailable; payment was not settled.',
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
