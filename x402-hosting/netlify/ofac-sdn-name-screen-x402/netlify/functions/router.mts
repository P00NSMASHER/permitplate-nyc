import { router, json, error } from './runtime.mts';

const PAY_TO = '0x708f7b52b56eafd7fc1de65fc7752ed732914021';
const NETWORK = 'eip155:8453';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const AMOUNT = '5000';
const PRICE = '$0.005';
const FACILITATOR = 'https://facilitator.payai.network';
const PUBLIC_API_BASE = 'https://ofac-sdn-name-screen-x402.netlify.app';
const PUBLIC_SITE_BASE = 'https://ofac-sdn-name-screen-x402.netlify.app';
const OFAC_BASE =
  'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';
const OFAC_UA = 'x402-ofac-screen/1.0 (' + PUBLIC_SITE_BASE + ')';
const CACHE_MS = 10 * 60 * 1000;

type SdnEntry = {
  uid: string;
  name: string;
  type: string | null;
  program: string | null;
  title: string | null;
  remarks: string | null;
  aliases: Array<{ type: string | null; name: string; remarks: string | null }>;
};

let cache: { loadedAt: number; entries: SdnEntry[] } | null = null;

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
      queryParams: { name: 'VLADIMIR PUTIN', limit: 5, minScore: 85 },
    },
    output: {
      type: 'json',
      example: {
        query: 'VLADIMIR PUTIN',
        count: 1,
        candidates: [
          {
            uid: '...',
            primaryName: 'PUTIN, Vladimir Vladimirovich',
            score: 99,
            matchedOn: 'primary',
          },
        ],
        source: 'U.S. Treasury OFAC SDN List',
        reviewRequired: true,
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
              name: { type: 'string', minLength: 2, maxLength: 160 },
              limit: { type: 'integer', minimum: 1, maximum: 10 },
              minScore: { type: 'integer', minimum: 70, maximum: 100 },
            },
            required: ['name'],
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
      url: PUBLIC_API_BASE + '/api/ofac-sdn-screen',
      description:
        'Screen a person or organization name against current OFAC SDN primary names and aliases and return review candidates with similarity scores.',
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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some(value => value.length)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some(value => value.length)) rows.push(row);
  }
  return rows;
}

function clean(value: string | undefined): string | null {
  if (!value || value === '-0-') return null;
  return value.trim() || null;
}

async function fetchOfacFile(name: string): Promise<string> {
  const res = await fetch(OFAC_BASE + '/' + name, {
    headers: { 'User-Agent': OFAC_UA, Accept: 'text/csv,*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('OFAC returned ' + res.status + ' for ' + name);
  return await res.text();
}

async function loadEntries(): Promise<SdnEntry[]> {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.entries;
  const [sdnText, altText] = await Promise.all([
    fetchOfacFile('SDN.CSV'),
    fetchOfacFile('ALT.CSV'),
  ]);
  const primaryRows = parseCsv(sdnText);
  const aliasRows = parseCsv(altText);
  const map = new Map<string, SdnEntry>();

  for (const cols of primaryRows) {
    const uid = (cols[0] ?? '').trim();
    const name = (cols[1] ?? '').trim();
    if (!uid || !name) continue;
    map.set(uid, {
      uid,
      name,
      type: clean(cols[2]),
      program: clean(cols[3]),
      title: clean(cols[4]),
      remarks: clean(cols[11]),
      aliases: [],
    });
  }

  for (const cols of aliasRows) {
    const uid = (cols[0] ?? '').trim();
    const altName = (cols[3] ?? '').trim();
    const entry = map.get(uid);
    if (!entry || !altName) continue;
    entry.aliases.push({
      type: clean(cols[2]),
      name: altName,
      remarks: clean(cols[4]),
    });
  }

  const entries = Array.from(map.values());
  cache = { loadedAt: Date.now(), entries };
  return entries;
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sortedTokens(value: string): string {
  return normalizeName(value).split(' ').filter(Boolean).sort().join(' ');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < next.length; j += 1) prev[j] = next[j];
  }
  return prev[b.length];
}

function jaccardTokens(a: string, b: string): number {
  const aa = new Set(normalizeName(a).split(' ').filter(Boolean));
  const bb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let shared = 0;
  for (const token of aa) if (bb.has(token)) shared += 1;
  const union = new Set([...aa, ...bb]).size;
  return shared / union;
}

function scoreName(query: string, candidate: string): number {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (sortedTokens(q) === sortedTokens(c)) return 99;
  const contains =
    q.length >= 5 && c.length >= 5 && (q.includes(c) || c.includes(q)) ? 94 : 0;
  const maxLen = Math.max(q.length, c.length);
  const edit = maxLen ? (1 - levenshtein(q, c) / maxLen) * 100 : 0;
  const editSorted = maxLen
    ? (1 -
        levenshtein(sortedTokens(q), sortedTokens(c)) /
          Math.max(sortedTokens(q).length, sortedTokens(c).length, 1)) *
      100
    : 0;
  const tokens = jaccardTokens(q, c) * 100;
  return Math.max(contains, edit, editSorted, tokens);
}

async function screenName(name: string, limit: number, minScore: number) {
  const entries = await loadEntries();
  const candidates: Array<Record<string, unknown>> = [];

  for (const entry of entries) {
    let bestScore = scoreName(name, entry.name);
    let matchedOn = 'primary';
    let matchedName = entry.name;
    for (const alias of entry.aliases) {
      const aliasScore = scoreName(name, alias.name);
      if (aliasScore > bestScore) {
        bestScore = aliasScore;
        matchedOn = 'alias';
        matchedName = alias.name;
      }
    }
    if (bestScore >= minScore) {
      candidates.push({
        uid: entry.uid,
        primaryName: entry.name,
        type: entry.type,
        program: entry.program,
        title: entry.title,
        remarks: entry.remarks,
        matchedOn,
        matchedName,
        score: Math.round(bestScore),
      });
    }
  }

  candidates.sort(
    (a, b) =>
      Number(b.score) - Number(a.score) ||
      String(a.primaryName).localeCompare(String(b.primaryName))
  );
  return {
    query: name,
    minScore,
    count: Math.min(candidates.length, limit),
    totalCandidatesAboveThreshold: candidates.length,
    candidates: candidates.slice(0, limit),
    source: 'U.S. Treasury OFAC Specially Designated Nationals (SDN) List',
    sourceFiles: ['SDN.CSV', 'ALT.CSV'],
    reviewRequired: true,
    limitations: [
      'Candidate-name screening only; a match is not a legal determination.',
      'A no-match is not a sanctions clearance.',
      'This service does not implement OFAC 50 Percent Rule ownership analysis.',
      'Review identifiers, addresses, dates of birth, program tags, and other OFAC data before acting.',
    ],
  };
}

function parseInput(query: Record<string, string>) {
  const name = (query.name ?? '').trim();
  const parsedLimit = Number.parseInt(query.limit ?? '5', 10);
  const parsedScore = Number.parseInt(query.minScore ?? '85', 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 10))
    : 5;
  const minScore = Number.isFinite(parsedScore)
    ? Math.max(70, Math.min(parsedScore, 100))
    : 85;
  return { name, limit, minScore };
}

function validateName(name: string) {
  if (name.length < 2) return 'name must contain at least 2 characters.';
  if (name.length > 160) return 'name must be 160 characters or fewer.';
  return null;
}

function openApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'OFAC SDN Name Screen x402',
      version: '1.0.0',
      description:
        'Pay-per-call candidate-name screening against current U.S. Treasury OFAC SDN primary names and aliases. Returns ranked review candidates with explicit compliance limitations.',
      contact: { name: 'x402 Seller', url: PUBLIC_SITE_BASE },
      'x-guidance':
        'Call GET /api/ofac-sdn-screen when an agent needs a factual first-pass name screen against current OFAC SDN primary names and aliases. Supply name, optional limit 1-10, and optional minScore 70-100. Price is $0.005 USDC on Base. Use returned candidates for review only. Do not interpret a match as a legal determination, or a no-match as clearance. This endpoint does not implement OFAC 50 Percent Rule ownership analysis.',
    },
    servers: [{ url: PUBLIC_API_BASE }],
    paths: {
      '/api/ofac-sdn-screen': {
        get: {
          operationId: 'screenOfacSdnName',
          summary: 'Screen one name against OFAC SDN names and aliases',
          tags: ['OFAC', 'Sanctions', 'Compliance'],
          security: [],
          'x-payment-info': {
            price: { mode: 'fixed', currency: 'USD', amount: '0.005000' },
            protocols: [{ x402: {} }],
          },
          parameters: [
            {
              name: 'name',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 2, maxLength: 160 },
              example: 'VLADIMIR PUTIN',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
            },
            {
              name: 'minScore',
              in: 'query',
              required: false,
              schema: {
                type: 'integer',
                minimum: 70,
                maximum: 100,
                default: 85,
              },
            },
          ],
          responses: {
            '200': { description: 'Paid candidate-screening result' },
            '400': { description: 'Invalid name input' },
            '402': { description: 'Payment Required' },
            '502': {
              description: 'OFAC source unavailable; payment is not settled',
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
        service: 'OFAC SDN Name Screen x402',
        price: PRICE,
        network: NETWORK,
        cached: Boolean(cache),
        cacheAgeSeconds: cache
          ? Math.round((Date.now() - cache.loadedAt) / 1000)
          : null,
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
        name: 'OFAC SDN Name Screen x402',
        description:
          'Current OFAC SDN candidate-name screening for autonomous agents.',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/ofac-sdn-screen',
            method: 'GET',
            description:
              'Screen a name against current OFAC SDN primary names and aliases. Returns ranked review candidates and explicit limitations; no-match is not clearance.',
            price: PRICE,
            tags: [
              'ofac',
              'sanctions',
              'sdn',
              'compliance',
              'aml',
              'entity-screening',
            ],
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 2, maxLength: 160 },
                limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
                minScore: {
                  type: 'integer',
                  minimum: 70,
                  maximum: 100,
                  default: 85,
                },
              },
              required: ['name'],
            },
            outputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                count: { type: 'integer' },
                candidates: { type: 'array' },
                source: { type: 'string' },
                reviewRequired: { type: 'boolean' },
                limitations: { type: 'array' },
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
        name: 'OFAC SDN Name Screen x402',
        resources: [
          {
            resource: PUBLIC_API_BASE + '/api/ofac-sdn-screen',
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
        '# OFAC SDN Name Screen x402\n\n' +
          'Purpose: first-pass candidate-name screening against current OFAC SDN primary names and aliases.\n' +
          'Paid endpoint: GET ' +
          PUBLIC_API_BASE +
          '/api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=5&minScore=85\n' +
          'Price: $0.005 USDC on Base via x402.\n' +
          'Source: U.S. Treasury OFAC Sanctions List Service, SDN.CSV and ALT.CSV.\n' +
          'Important: candidate screening only. A match is not a legal determination; a no-match is not clearance; 50 Percent Rule ownership analysis is not included.\n' +
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
        '# OFAC SDN Name Screen x402 — full agent guide\n\n' +
          'Call GET /api/ofac-sdn-screen with name. Optional limit is 1-10 and minScore is 70-100, default 85.\n' +
          'Executable example: ' +
          PUBLIC_API_BASE +
          '/api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=5&minScore=85\n' +
          'Unpaid calls return HTTP 402 and PAYMENT-REQUIRED. Price is $0.005 USDC on Base.\n' +
          'The service verifies payment, downloads current OFAC SDN.CSV and ALT.CSV with an explicit User-Agent, performs deterministic name/alias similarity screening, then settles. OFAC download failure before a result means payment is not settled.\n' +
          'Interpretation: results are review candidates only. Do not treat a hit as a legal determination or a no-hit as clearance. The service does not perform ownership analysis for OFAC 50 Percent Rule.\n'
      ),
  ],
  'GET /skill.md': [
    async () =>
      plain(
        '# OFAC SDN Name Screen x402\n\n## When to use\nUse for a low-cost first-pass name screen against current OFAC SDN primary names and aliases.\n\n## Input\nGET /api/ofac-sdn-screen?name=VLADIMIR%20PUTIN&limit=5&minScore=85\n\n## Price\n$0.005 USDC on Base via x402.\n\n## Output\nRanked candidate records with primary name, matched alias/name, SDN type, program, remarks and score.\n\n## Source\nU.S. Treasury OFAC Sanctions List Service.\n\n## Limitations\nCandidate review only; not legal advice, not a clearance determination, and no 50 Percent Rule ownership analysis.\n',
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
      const input = parseInput(query);
      const invalid = validateName(input.name);
      if (invalid) return error(invalid, 400);
      try {
        const result = await screenName(
          input.name,
          Math.min(input.limit, 3),
          input.minScore
        );
        return json({ ...result, demo: true });
      } catch {
        return error(
          'OFAC Sanctions List Service is temporarily unavailable.',
          502
        );
      }
    },
  ],
  'GET /api/ofac-sdn-screen': [
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

      const input = parseInput(query);
      const invalid = validateName(input.name);
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
          result = await screenName(input.name, input.limit, input.minScore);
        } catch {
          return error(
            'OFAC Sanctions List Service is temporarily unavailable; payment was not settled.',
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
