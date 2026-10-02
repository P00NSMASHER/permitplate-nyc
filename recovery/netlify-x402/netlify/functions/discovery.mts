import { paymentRequirements } from '../../../x402-payment-core.mjs';
import {
  ORIGIN,
  SERVICES,
  resourceRecord,
} from './_shared/catalog.mts';

function json(value) {
  return new Response(JSON.stringify(value, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function text(value, contentType = 'text/plain; charset=utf-8') {
  return new Response(value, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

function manifest() {
  return {
    x402Version: 2,
    name: 'Agent Data Tools x402',
    description:
      'Eight same-origin x402 tools for business identity, vendor intake decisions, SEC filings, Census geocoding, OFAC name screening, RDAP, and Treasury rates.',
    openapi: ORIGIN + '/openapi.json',
    llms: ORIGIN + '/llms.txt',
    skill: ORIGIN + '/skill.txt',
    resources: SERVICES.map(resourceRecord),
  };
}

function openApi() {
  const paths = {};
  for (const service of SERVICES) {
    const required = new Set(service.inputSchema.required ?? []);
    paths[service.path] = {
      get: {
        operationId: service.operationId,
        summary: service.name,
        description: service.description,
        tags: service.tags,
        security: [],
        'x-payment-info': {
          price: {
            mode: 'fixed',
            currency: 'USD',
            amount: service.price.replace('$', ''),
          },
          protocols: [{ x402: {} }],
          network: 'eip155:8453',
          payTo: paymentRequirements(service.amount).payTo,
        },
        parameters: Object.entries(service.inputSchema.properties ?? {}).map(
          ([name, schema]) => ({
            name,
            in: 'query',
            required: required.has(name),
            schema,
            example: service.sample[name],
          })
        ),
        responses: {
          '200': {
            description: 'Successful paid result',
            content: {
              'application/json': { schema: service.outputSchema },
            },
          },
          '400': { description: 'Invalid input after payment header is supplied' },
          '402': { description: 'Payment Required' },
          '502': {
            description: 'Required upstream data unavailable; payment is not settled',
          },
          '503': {
            description: 'Payment verification or settlement temporarily unavailable',
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Data Tools x402',
      version: '1.0.0',
      description:
        'Same-origin x402 portfolio for autonomous agents. The vendor-intake gate returns proceed or human_review; its output is a workflow signal, not legal or sanctions clearance.',
    },
    servers: [{ url: ORIGIN }],
    paths,
  };
}

function llmsFull() {
  const lines = [
    '# Agent Data Tools x402 — full guide',
    '',
    'All paid routes use x402 v2, Base USDC, and the same seller payout wallet.',
    'An unpaid request returns HTTP 402 plus PAYMENT-REQUIRED.',
    'If a required public-data source fails after payment verification but before settlement, the call returns an upstream error and payment is not settled.',
    '',
  ];
  for (const service of SERVICES) {
    const params = new URLSearchParams(
      Object.entries(service.sample).map(([key, value]) => [key, String(value)])
    ).toString();
    lines.push(
      '## ' + service.name,
      service.description,
      'GET ' + ORIGIN + service.path + (params ? '?' + params : ''),
      'Price: ' + service.price + ' USDC on Base.',
      ''
    );
  }
  lines.push(
    'Vendor-intake limitations: proceed means only that configured automated review triggers were not hit. It is not legal/compliance approval, sanctions clearance, fraud/credit approval, proof of good standing, or proof of ownership/control. OFAC screening is candidate-name screening only and does not implement the 50 Percent Rule.'
  );
  return lines.join('\n');
}

export default async (req) => {
  const path = new URL(req.url).pathname;

  if (path === '/.well-known/x402' || path === '/.well-known/x402.json') {
    return json(manifest());
  }
  if (path === '/openapi.json') return json(openApi());
  if (path === '/llms.txt') {
    return text(
      '# Agent Data Tools x402\n\n' +
        'Eight same-origin paid tools. Discovery: ' +
        ORIGIN +
        '/.well-known/x402\nOpenAPI: ' +
        ORIGIN +
        '/openapi.json\nVendor gate: ' +
        ORIGIN +
        '/_api/vendor-intake-gate\n'
    );
  }
  if (path === '/llms-full.txt') return text(llmsFull());
  if (path === '/skill.txt' || path === '/skill.md') {
    return text(
      '# Agent Data Tools x402\n\nUse the raw data routes for facts and the vendor-intake gate when an autonomous workflow needs proceed vs human_review. The gate is fail-closed on ambiguous, incomplete, or inconsistent evidence. A proceed result is not legal/compliance approval or sanctions clearance.\n',
      path.endsWith('.md')
        ? 'text/markdown; charset=utf-8'
        : 'text/plain; charset=utf-8'
    );
  }
  if (path === '/robots.txt') {
    return text('User-agent: *\nAllow: /\nSitemap: ' + ORIGIN + '/sitemap.xml\n');
  }
  if (path === '/sitemap.xml') {
    const paths = [
      '/',
      '/.well-known/x402',
      '/openapi.json',
      '/llms.txt',
      '/llms-full.txt',
      '/skill.txt',
    ];
    return text(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
        paths.map((item) => '<url><loc>' + ORIGIN + item + '</loc></url>').join('') +
        '</urlset>',
      'application/xml; charset=utf-8'
    );
  }

  return json({ error: 'not_found' });
};

export const config = {
  path: [
    '/.well-known/x402',
    '/.well-known/x402.json',
    '/openapi.json',
    '/llms.txt',
    '/llms-full.txt',
    '/skill.txt',
    '/skill.md',
    '/robots.txt',
    '/sitemap.xml',
  ],
};
