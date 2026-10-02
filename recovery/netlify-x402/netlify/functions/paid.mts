import { executePaidOperation } from '../../../x402-paid-operation.mjs';
import {
  searchPennsylvaniaEntities,
  runVendorIntakeGate,
  lookupSecFilings,
  geocodeAddress,
  screenOfacName,
  lookupDomain,
  latestTreasuryRates,
} from '../../../x402-rehost-core.mjs';
import {
  ORIGIN,
  SERVICE_BY_PATH,
  bazaarExtension,
} from './_shared/catalog.mts';

function responseFrom(result) {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...result.headers,
    },
  });
}

function significantLength(value) {
  return [...String(value ?? '')].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
}

function searchTerm(raw, max = 120) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length > max) throw new Error('query_too_long');
  if (significantLength(value) < 2) throw new Error('query_too_short');
  return value;
}

function address(raw) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 6 || value.length > 240) throw new Error('invalid_address');
  return value;
}

function domain(raw) {
  let value = String(raw ?? '').trim().toLowerCase();
  if (value.endsWith('.')) value = value.slice(0, -1);
  if (
    value.length < 3 ||
    value.length > 253 ||
    !/^[a-z0-9.-]+$/.test(value) ||
    !value.includes('.')
  ) {
    throw new Error('invalid_domain');
  }
  const labels = value.split('.');
  if (
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        label.startsWith('-') ||
        label.endsWith('-')
    )
  ) {
    throw new Error('invalid_domain');
  }
  return value;
}

function integer(raw, fallback, min, max, errorName) {
  if (raw == null || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw))) throw new Error(errorName);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(errorName);
  }
  return value;
}

function serviceOperation(service, url) {
  switch (service.id) {
    case 'pa-best-match':
      return {
        validateInput: async () => ({ q: searchTerm(url.searchParams.get('q')) }),
        execute: async ({ q }) => {
          const result = await searchPennsylvaniaEntities(q, 1);
          return {
            query: result.query,
            found: result.count > 0,
            match: result.results[0] ?? null,
            source: result.source,
          };
        },
      };

    case 'pa-enriched-search':
      return {
        validateInput: async () => ({
          q: searchTerm(url.searchParams.get('q')),
          limit: integer(url.searchParams.get('limit'), 10, 1, 25, 'invalid_limit'),
        }),
        execute: async ({ q, limit }) => searchPennsylvaniaEntities(q, limit),
      };

    case 'vendor-intake-gate':
      return {
        validateInput: async () => ({
          name: searchTerm(url.searchParams.get('name')),
          address: address(url.searchParams.get('address')),
          domain: domain(url.searchParams.get('domain')),
        }),
        execute: async (input) => runVendorIntakeGate(input),
      };

    case 'sec-recent-filings':
      return {
        validateInput: async () => {
          const ticker = String(url.searchParams.get('ticker') ?? '').trim();
          const cik = String(url.searchParams.get('cik') ?? '').trim();
          const form = String(url.searchParams.get('form') ?? '').trim();
          if (!ticker && !cik) throw new Error('provide_ticker_or_cik');
          if (ticker.length > 12) throw new Error('invalid_ticker');
          if (cik && !/^\d{1,10}$/.test(cik)) throw new Error('invalid_cik');
          if (form.length > 20) throw new Error('invalid_form');
          return {
            ticker,
            cik,
            form,
            limit: integer(url.searchParams.get('limit'), 10, 1, 25, 'invalid_limit'),
          };
        },
        execute: async (input) => lookupSecFilings(input),
      };

    case 'census-geocoder':
      return {
        validateInput: async () => ({ address: address(url.searchParams.get('address')) }),
        execute: async ({ address: value }) => geocodeAddress(value),
      };

    case 'ofac-sdn-screen':
      return {
        validateInput: async () => ({
          name: searchTerm(url.searchParams.get('name'), 160),
          limit: integer(url.searchParams.get('limit'), 5, 1, 10, 'invalid_limit'),
          minScore: integer(url.searchParams.get('minScore'), 85, 70, 100, 'invalid_min_score'),
        }),
        execute: async ({ name, limit, minScore }) =>
          screenOfacName(name, { limit, minScore }),
      };

    case 'domain-rdap':
      return {
        validateInput: async () => ({ domain: domain(url.searchParams.get('domain')) }),
        execute: async ({ domain: value }) => lookupDomain(value),
      };

    case 'treasury-average-rates':
      return {
        validateInput: async () => {
          const security = String(url.searchParams.get('security') ?? '').trim();
          if (security.length > 100) throw new Error('invalid_security_filter');
          return { security };
        },
        execute: async ({ security }) => latestTreasuryRates(security),
      };

    default:
      throw new Error('unknown_service');
  }
}

export default async (req) => {
  const url = new URL(req.url);
  const service = SERVICE_BY_PATH.get(url.pathname);
  if (!service) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const operation = serviceOperation(service, url);
  const result = await executePaidOperation({
    signature:
      req.headers.get('payment-signature') ?? req.headers.get('x-payment'),
    origin: ORIGIN,
    path: service.path,
    amount: service.amount,
    price: service.price,
    description: service.description,
    serviceName: service.name,
    tags: service.tags,
    extensions: bazaarExtension(service),
    validateInput: operation.validateInput,
    execute: operation.execute,
    upstreamFailureMessage:
      'Required public data is temporarily unavailable; payment was not settled.',
  });
  return responseFrom(result);
};

export const config = {
  path: [
    '/_api/pa-entity-one',
    '/_api/pa-business',
    '/_api/vendor-intake-gate',
    '/_api/sec-filings',
    '/_api/us-address-geocode',
    '/_api/ofac-sdn-screen',
    '/_api/domain-rdap',
    '/_api/treasury-average-rates',
  ],
};
