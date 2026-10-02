import { router, json, error } from './runtime.mts';

const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT = '5000';
const PRICE = '$0.005';
const FACILITATOR = 'https://facilitator.payai.network';
const PUBLIC_API_BASE = 'https://us-census-address-geocoder-x402.netlify.app';
const PUBLIC_SITE_BASE = 'https://us-census-address-geocoder-x402.netlify.app';

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
      queryParams: { address: '4600 Silver Hill Rd, Washington, DC 20233' },
    },
    output: {
      type: 'json',
      example: {
        input: '4600 Silver Hill Rd, Washington, DC 20233',
        matched: true,
        matchedAddress: '4600 SILVER HILL RD, WASHINGTON, DC, 20233',
        coordinates: { longitude: -76.92836638093, latitude: 38.84505589808 },
        geographies: {
          stateFips: '24',
          countyFips: '033',
          countyGeoid: '24033',
          tract: '802405',
          tractGeoid: '24033802405',
          block: '2004',
          blockGeoid: '240338024052004',
          congressionalDistrict: '4',
        },
        source: 'U.S. Census Bureau Geocoding Services',
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
            properties: { address: { type: 'string', minLength: 6 } },
            required: ['address'],
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
      url: PUBLIC_API_BASE + '/api/us-address-geocode',
      description:
        'Geocode a U.S. address to a standardized Census match, coordinates, and Census geography identifiers.',
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

function firstGeoByKey(
  geographies: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const value = geographies[key];
  return Array.isArray(value) && value.length
    ? (value[0] as Record<string, unknown>)
    : null;
}

function firstGeoByPattern(
  geographies: Record<string, unknown>,
  pattern: RegExp
): Record<string, unknown> | null {
  for (const [key, value] of Object.entries(geographies)) {
    if (pattern.test(key) && Array.isArray(value) && value.length) {
      return value[0] as Record<string, unknown>;
    }
  }
  return null;
}

async function geocode(address: string) {
  const url = new URL(
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
  );
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('format', 'json');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Census returned ' + res.status);
  const data = (await res.json()) as Record<string, any>;
  const match = data.result?.addressMatches?.[0] as
    | Record<string, any>
    | undefined;
  if (!match) {
    return {
      input: address,
      matched: false,
      matchedAddress: null,
      coordinates: null,
      addressComponents: null,
      geographies: null,
      source: 'U.S. Census Bureau Geocoding Services',
    };
  }

  const geos = (match.geographies ?? {}) as Record<string, unknown>;
  const state = firstGeoByKey(geos, 'States');
  const county = firstGeoByKey(geos, 'Counties');
  const tract = firstGeoByKey(geos, 'Census Tracts');
  const block =
    firstGeoByKey(geos, 'Census Blocks') ??
    firstGeoByPattern(geos, /^\d{4} Census Blocks$/i);
  const district = firstGeoByPattern(
    geos,
    /^(?:\d+(?:st|nd|rd|th) )?Congressional Districts$/i
  );

  return {
    input: address,
    matched: true,
    matchedAddress: match.matchedAddress ?? null,
    coordinates: {
      longitude: match.coordinates?.x ?? null,
      latitude: match.coordinates?.y ?? null,
    },
    addressComponents: match.addressComponents ?? null,
    geographies: {
      stateFips: state?.STATE ?? null,
      countyFips: county?.COUNTY ?? null,
      countyGeoid: county?.GEOID ?? null,
      tract: tract?.TRACT ?? null,
      tractGeoid: tract?.GEOID ?? null,
      block: block?.BLOCK ?? null,
      blockGeoid: block?.GEOID ?? null,
      congressionalDistrict: district?.CD ?? district?.BASENAME ?? null,
    },
    source: 'U.S. Census Bureau Geocoding Services',
  };
}

function validateAddress(address: string) {
  if (address.length < 6) return 'address must contain at least 6 characters.';
  if (address.length > 240) return 'address must be 240 characters or fewer.';
  return null;
}

function openApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'US Census Address Geocoder x402',
      version: '1.0.0',
      description:
        'Pay-per-call U.S. address geocoding using the official Census Bureau Geocoding Services API. Returns standardized match, coordinates, and Census geography identifiers.',
      contact: { name: 'x402 Seller', url: PUBLIC_SITE_BASE },
      'x-guidance':
        'Call GET /api/us-address-geocode when an agent needs an authoritative U.S. address match, latitude/longitude, or Census geography identifiers. Supply one complete address string. Price is $0.005 USDC on Base. The service is limited to U.S., Puerto Rico, and U.S. Island Areas supported by the Census geocoder and returns matched=false when no Census match is found.',
    },
    servers: [{ url: PUBLIC_API_BASE }],
    paths: {
      '/api/us-address-geocode': {
        get: {
          operationId: 'geocodeUsAddress',
          summary: 'Geocode one U.S. address with Census geography',
          tags: ['Geocoding', 'Census', 'Reference Data'],
          security: [],
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: '0.005000' },
            protocols: [{ x402: {} }],
          },
          parameters: [
            {
              name: 'address',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 6, maxLength: 240 },
              example: '4600 Silver Hill Rd, Washington, DC 20233',
            },
          ],
          responses: {
            '200': { description: 'Paid Census geocoding result' },
            '400': { description: 'Invalid address input' },
            '402': { description: 'Payment Required' },
            '502': {
              description: 'Census unavailable; payment is not settled',
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
        service: 'US Census Address Geocoder x402',
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
        name: 'US Census Address Geocoder x402',
        description:
          'Official U.S. Census address geocoding and geography lookup for autonomous agents.',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/us-address-geocode',
            method: 'GET',
            description:
              'Geocode one U.S. address. Returns standardized address, longitude, latitude, state/county/tract/block identifiers, and match status.',
            price: PRICE,
            tags: [
              'geocoding',
              'address',
              'census',
              'fips',
              'county',
              'tract',
              'reference',
            ],
            inputSchema: {
              type: 'object',
              properties: {
                address: { type: 'string', minLength: 6, maxLength: 240 },
              },
              required: ['address'],
            },
            outputSchema: {
              type: 'object',
              properties: {
                input: { type: 'string' },
                matched: { type: 'boolean' },
                matchedAddress: { type: ['string', 'null'] },
                coordinates: { type: ['object', 'null'] },
                geographies: { type: ['object', 'null'] },
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
        name: 'US Census Address Geocoder x402',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/us-address-geocode',
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
        '# US Census Address Geocoder x402\n\n' +
          'Purpose: standardized U.S. address geocoding and Census geography enrichment.\n' +
          'Paid endpoint: GET ' +
          PUBLIC_API_BASE +
          '/api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233\n' +
          'Price: $0.005 USDC on Base via x402.\n' +
          'Returns: match status, standardized address, longitude/latitude, address components, and Census geography identifiers.\n' +
          'Source: U.S. Census Bureau Geocoding Services API.\n' +
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
        '# US Census Address Geocoder x402 — full agent guide\n\n' +
          'Call GET /api/us-address-geocode with a complete address string.\n' +
          'Executable example: ' +
          PUBLIC_API_BASE +
          '/api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233\n' +
          'Unpaid calls return HTTP 402 and PAYMENT-REQUIRED. The price is $0.005 USDC on Base.\n' +
          'The service verifies payment, calls the Census geographies/onelineaddress endpoint, and only then settles. An upstream failure before a result means payment is not settled.\n' +
          'A valid no-match is returned as matched=false and is still a completed lookup.\n' +
          'Limitations: coverage follows the Census Geocoder: U.S., Puerto Rico, and supported U.S. Island Areas; it is not a postal-deliverability guarantee.\n'
      ),
  ],
  'GET /skill.md': [
    async () =>
      plain(
        '# US Census Address Geocoder x402\n\n## When to use\nUse for exact U.S. address normalization, coordinates, county/FIPS/tract/block enrichment, and geography resolution.\n\n## Input\nGET /api/us-address-geocode?address=4600%20Silver%20Hill%20Rd%2C%20Washington%2C%20DC%2020233\n\n## Price\n$0.005 USDC on Base via x402.\n\n## Source\nU.S. Census Bureau Geocoding Services.\n\n## Do not use for\nPostal deliverability guarantees or addresses outside Census Geocoder coverage.\n',
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
      const address = (query.address ?? '').trim();
      const invalid = validateAddress(address);
      if (invalid) return error(invalid, 400);
      try {
        const result = await geocode(address);
        return json({ ...result, demo: true });
      } catch {
        return error(
          'U.S. Census Geocoding Services are temporarily unavailable.',
          502
        );
      }
    },
  ],
  'GET /api/us-address-geocode': [
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

      const address = (query.address ?? '').trim();
      const invalid = validateAddress(address);
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
          result = await geocode(address);
        } catch {
          return error(
            'U.S. Census Geocoding Services are temporarily unavailable; payment was not settled.',
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
