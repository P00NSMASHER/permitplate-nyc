import { paymentRequirements } from '../../../../x402-payment-core.mjs';

export const ORIGIN = 'https://agent-data-tools-x402.netlify.app';

export const SERVICES = [
  {
    id: 'pa-best-match',
    name: 'Pennsylvania Business Registry Best Match',
    path: '/_api/pa-entity-one',
    price: '$0.001',
    amount: '1000',
    operationId: 'pennsylvaniaBusinessRegistryBestMatch',
    description: 'Resolve one best Pennsylvania legal-entity match by company name.',
    tags: ['pennsylvania', 'business-registry', 'entity-resolution', 'company-identity'],
    sample: { q: 'OpenAI' },
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string', minLength: 2, maxLength: 120 } },
      required: ['q'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
  {
    id: 'pa-enriched-search',
    name: 'Pennsylvania Business Registry Enriched Search',
    path: '/_api/pa-business',
    price: '$0.005',
    amount: '5000',
    operationId: 'pennsylvaniaBusinessRegistrySearch',
    description: 'Return ranked Pennsylvania business-registry candidates with filing and address facts.',
    tags: ['pennsylvania', 'business-registry', 'company-data', 'due-diligence'],
    sample: { q: 'OpenAI', limit: 3 },
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 2, maxLength: 120 },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
      required: ['q'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
  {
    id: 'vendor-intake-gate',
    name: 'Pennsylvania Vendor Intake Decision Gate',
    path: '/_api/vendor-intake-gate',
    price: '$0.020',
    amount: '20000',
    operationId: 'checkPennsylvaniaVendorIntakeGate',
    description: 'Return proceed or human_review for a prospective Pennsylvania vendor using PA registry, Census, OFAC, and RDAP evidence.',
    tags: ['vendor-intake', 'agent-decision', 'human-review', 'ofac', 'census', 'rdap'],
    sample: {
      name: 'OpenAI OpCo',
      address: '600 North Second Street, Suite 401, Harrisburg, PA 17101',
      domain: 'openai.com',
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 120 },
        address: { type: 'string', minLength: 6, maxLength: 240 },
        domain: { type: 'string', minLength: 3, maxLength: 253 },
      },
      required: ['name', 'address', 'domain'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['proceed', 'human_review'] },
        agentAction: {
          type: 'string',
          enum: ['continue_vendor_intake', 'pause_and_request_human_review'],
        },
        reviewTriggers: { type: 'array' },
        evidence: { type: 'object' },
        limitations: { type: 'array' },
      },
      required: ['decision', 'agentAction', 'reviewTriggers', 'evidence', 'limitations'],
    },
  },
  {
    id: 'sec-recent-filings',
    name: 'SEC Recent Filings',
    path: '/_api/sec-filings',
    price: '$0.005',
    amount: '5000',
    operationId: 'getRecentSecFilings',
    description: 'Return authoritative recent SEC EDGAR filing metadata by ticker or CIK.',
    tags: ['sec', 'edgar', 'filings', 'company-data'],
    sample: { ticker: 'AAPL', form: '10-K', limit: 3 },
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', maxLength: 12 },
        cik: { type: 'string', pattern: '^\\d{1,10}$' },
        form: { type: 'string', maxLength: 20 },
        limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 },
      },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
  {
    id: 'census-geocoder',
    name: 'US Census Address Geocoder',
    path: '/_api/us-address-geocode',
    price: '$0.005',
    amount: '5000',
    operationId: 'geocodeUsAddress',
    description: 'Geocode one U.S. address using official Census Bureau Geocoding Services.',
    tags: ['geocoding', 'address', 'census', 'reference-data'],
    sample: { address: '4600 Silver Hill Rd, Washington, DC 20233' },
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', minLength: 6, maxLength: 240 } },
      required: ['address'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
  {
    id: 'ofac-sdn-screen',
    name: 'OFAC SDN Name Screen',
    path: '/_api/ofac-sdn-screen',
    price: '$0.005',
    amount: '5000',
    operationId: 'screenOfacSdnName',
    description: 'Screen one name against current OFAC SDN primary names and aliases; candidates require human review.',
    tags: ['ofac', 'sanctions', 'sdn', 'name-screening'],
    sample: { name: 'VLADIMIR PUTIN', limit: 3, minScore: 85 },
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 160 },
        limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
        minScore: { type: 'integer', minimum: 70, maximum: 100, default: 85 },
      },
      required: ['name'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
  {
    id: 'domain-rdap',
    name: 'Domain RDAP Lookup',
    path: '/_api/domain-rdap',
    price: '$0.005',
    amount: '5000',
    operationId: 'lookupDomainRdap',
    description: 'Return authoritative domain-registration metadata using IANA RDAP bootstrap.',
    tags: ['domain', 'rdap', 'registration', 'dns'],
    sample: { domain: 'example.com' },
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', minLength: 3, maxLength: 253 } },
      required: ['domain'],
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
  {
    id: 'treasury-average-rates',
    name: 'Treasury Average Interest Rates',
    path: '/_api/treasury-average-rates',
    price: '$0.005',
    amount: '5000',
    operationId: 'getTreasuryAverageInterestRates',
    description: 'Return latest monthly average interest rates on outstanding U.S. Treasury securities.',
    tags: ['treasury', 'interest-rates', 'macro', 'fiscal-data'],
    sample: { security: 'Total Marketable' },
    inputSchema: {
      type: 'object',
      properties: { security: { type: 'string', maxLength: 100 } },
      additionalProperties: false,
    },
    outputSchema: { type: 'object' },
  },
];

export const SERVICE_BY_PATH = new Map(SERVICES.map((service) => [service.path, service]));

export function bazaarExtension(service) {
  return {
    bazaar: {
      info: {
        input: { type: 'http', method: 'GET', queryParams: service.sample },
        output: { type: 'json', example: {} },
      },
      schema: {
        type: 'object',
        properties: {
          input: {
            type: 'object',
            properties: {
              type: { const: 'http' },
              method: { const: 'GET' },
              queryParams: service.inputSchema,
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
      },
    },
  };
}

export function resourceRecord(service) {
  return {
    resource: ORIGIN + service.path,
    type: 'http',
    x402Version: 2,
    method: 'GET',
    description: service.description,
    price: service.price,
    tags: service.tags,
    inputSchema: service.inputSchema,
    outputSchema: service.outputSchema,
    accepts: [paymentRequirements(service.amount)],
    extensions: bazaarExtension(service),
  };
}
