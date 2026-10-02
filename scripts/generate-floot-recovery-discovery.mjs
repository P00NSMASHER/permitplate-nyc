#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ORIGIN = 'https://pa-entity-x402.floot.app'
const TARGET = new URL('../recovery/floot-target-manifest.json', import.meta.url)

const SERVICE_METADATA = {
  '/_api/pa-entity-one': {
    serviceName: 'PA Business Registry',
    tags: ['pennsylvania', 'business-registry', 'entity-resolution', 'best-match'],
    operationId: 'paEntityBestMatch',
  },
  '/_api/pa-business': {
    serviceName: 'PA Business Registry',
    tags: ['pennsylvania', 'business-registry', 'company-identity'],
    operationId: 'paBusinessSearch',
  },
  '/_api/vendor-intake-gate': {
    serviceName: 'PA Vendor Intake Gate',
    tags: ['vendor-intake', 'agent-decision', 'human-review', 'business-registry', 'compliance'],
    operationId: 'checkPennsylvaniaVendorIntakeGate',
  },
  '/_api/sec-filings': {
    serviceName: 'SEC Recent Filings',
    tags: ['sec', 'edgar', 'filings', 'company-data'],
    operationId: 'secRecentFilings',
  },
  '/_api/us-address-geocode': {
    serviceName: 'US Census Geocoder',
    tags: ['census', 'geocoding', 'address', 'reference-data'],
    operationId: 'censusAddressGeocode',
  },
  '/_api/ofac-sdn-screen': {
    serviceName: 'OFAC SDN Name Screen',
    tags: ['ofac', 'sanctions', 'sdn', 'name-screening'],
    operationId: 'ofacSdnScreen',
  },
  '/_api/domain-rdap': {
    serviceName: 'Domain RDAP Lookup',
    tags: ['domain', 'rdap', 'registration', 'dns'],
    operationId: 'domainRdap',
  },
  '/_api/treasury-average-rates': {
    serviceName: 'Treasury Average Rates',
    tags: ['treasury', 'interest-rates', 'macro', 'fiscal-data'],
    operationId: 'treasuryAverageRates',
  },
}

const args = process.argv.slice(2)
const outFlag = args.indexOf('--out-dir')
const outDir = resolve(outFlag >= 0 && args[outFlag + 1] ? args[outFlag + 1] : 'recovery/generated-floot-discovery')

function pathOf(url) {
  return new URL(url).pathname
}

function assertPrintableAscii32(value, label) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 32 ||
    !/^[\x20-\x7E]+$/.test(value)
  ) {
    throw new Error(label + '_invalid')
  }
}

function validateResource(resource) {
  const path = pathOf(resource.resource)
  const metadata = SERVICE_METADATA[path]
  if (!metadata) throw new Error('unsupported_resource_' + path)
  if (new URL(resource.resource).origin !== ORIGIN) {
    throw new Error('wrong_origin_' + path)
  }
  if (resource.method !== 'GET') throw new Error('wrong_method_' + path)
  if (!Array.isArray(resource.accepts) || resource.accepts.length !== 1) {
    throw new Error('invalid_accepts_' + path)
  }
  const terms = resource.accepts[0]
  if (terms.scheme !== 'exact' || terms.network !== 'eip155:8453') {
    throw new Error('invalid_payment_terms_' + path)
  }
  if (String(terms.asset).toLowerCase() !== '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') {
    throw new Error('invalid_asset_' + path)
  }
  if (String(terms.payTo).toLowerCase() !== '0x708f7b52b56eafd7fc1de65fc7752ed732914021') {
    throw new Error('invalid_payto_' + path)
  }
  if (terms.extra?.name !== 'USD Coin' || terms.extra?.version !== '2') {
    throw new Error('invalid_usdc_domain_' + path)
  }
  assertPrintableAscii32(metadata.serviceName, 'serviceName_' + path)
  if (metadata.tags.length > 5) throw new Error('too_many_tags_' + path)
  for (const tag of metadata.tags) assertPrintableAscii32(tag, 'tag_' + path)
  return metadata
}

function discoveryResource(resource) {
  const metadata = validateResource(resource)
  return {
    resource: resource.resource,
    method: resource.method,
    type: 'http',
    x402Version: 2,
    description: resource.description,
    price: resource.price,
    serviceName: metadata.serviceName,
    tags: metadata.tags,
    inputSchema: resource.inputSchema,
    ...(resource.outputSchema ? { outputSchema: resource.outputSchema } : {}),
    accepts: resource.accepts,
  }
}

function parametersFor(resource) {
  const schema = resource.inputSchema ?? { type: 'object', properties: {} }
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: property,
  }))
}

function openApiPath(resource) {
  const path = pathOf(resource.resource)
  const metadata = validateResource(resource)
  return {
    get: {
      operationId: metadata.operationId,
      summary: resource.description,
      tags: metadata.tags,
      security: [],
      'x-payment-info': {
        price: {
          mode: 'fixed',
          currency: 'USD',
          amount: (Number(resource.accepts[0].amount) / 1_000_000).toFixed(6),
        },
        protocols: [{ x402: {} }],
        network: resource.accepts[0].network,
        payTo: resource.accepts[0].payTo,
      },
      parameters: parametersFor(resource),
      responses: {
        '200': {
          description:
            path === '/_api/vendor-intake-gate'
              ? 'Paid vendor-intake decision with evidence and review triggers'
              : 'Paid result',
          ...(resource.outputSchema
            ? { content: { 'application/json': { schema: resource.outputSchema } } }
            : {}),
        },
        '400': { description: 'Invalid input' },
        '402': { description: 'Payment Required' },
        '502': { description: 'Required public-data source unavailable; payment is not settled' },
        '503': { description: 'Payment verifier or settlement state temporarily unavailable' },
      },
    },
  }
}

function renderLlms(resources, full = false) {
  const lines = [
    '# Agent Data Tools x402 on Floot',
    '',
    'Eight same-origin pay-per-call tools for autonomous agents.',
    'Origin: ' + ORIGIN,
    'Payment: USDC on Base via x402 v2.',
    '',
  ]
  for (const resource of resources) {
    const path = pathOf(resource.resource)
    lines.push(
      '## ' + SERVICE_METADATA[path].serviceName,
      '- Endpoint: GET ' + resource.resource,
      '- Price: ' + resource.price + ' USDC',
      '- Purpose: ' + resource.description
    )
    if (full && path === '/_api/vendor-intake-gate') {
      lines.push(
        '- Decision: proceed or human_review with explicit evidence and review triggers.',
        '- Important: proceed is a workflow signal, not legal/compliance approval or sanctions clearance.',
        '- OFAC is candidate-name screening only; no 50 Percent Rule ownership analysis.'
      )
    }
    lines.push('')
  }
  lines.push(
    'Discovery: ' + ORIGIN + '/.well-known/x402',
    'OpenAPI: ' + ORIGIN + '/openapi.json',
    'Skill: ' + ORIGIN + '/skill.txt'
  )
  return lines.join('\n') + '\n'
}

function renderSkill(resources) {
  return [
    '# Agent Data Tools x402 on Floot',
    '',
    '## When to use',
    'Use these same-origin paid tools when an agent needs public-source facts or a bounded vendor-intake decision inside its working loop.',
    '',
    '## Paid resources',
    ...resources.map(resource => {
      const path = pathOf(resource.resource)
      return '- ' + SERVICE_METADATA[path].serviceName + ': GET ' + path + ' — ' + resource.price + ' USDC'
    }),
    '',
    '## Vendor intake gate',
    'The vendor gate combines Pennsylvania registry identity, Census address consistency, OFAC SDN candidate-name screening, and authoritative RDAP domain evidence.',
    'It returns decision=proceed or decision=human_review plus an agentAction, reviewTriggers, and evidence.',
    '',
    'Proceed only means the configured automated review triggers were not hit. It is not legal advice, sanctions clearance, good-standing certification, fraud approval, credit approval, or proof of address/domain control.',
    'OFAC evidence is candidate-name screening only and does not implement 50 Percent Rule ownership analysis.',
    '',
    '## Reviewer fixtures',
    'Exactly three fixed free fixtures are permitted: proceed, address_mismatch, and domain_mismatch. Arbitrary vendor screening remains paid.',
    '',
    '## Discovery',
    '- ' + ORIGIN + '/.well-known/x402',
    '- ' + ORIGIN + '/openapi.json',
    '- ' + ORIGIN + '/llms.txt',
    '- ' + ORIGIN + '/llms-full.txt',
    '',
  ].join('\n')
}

const target = JSON.parse(await readFile(TARGET, 'utf8'))
if (target.x402Version !== 2) throw new Error('target_x402_version')
if (!Array.isArray(target.resources) || target.resources.length !== 8) {
  throw new Error('target_resource_count')
}

const resources = target.resources.map(discoveryResource)
const canonical = {
  x402Version: 2,
  name: target.name ?? 'Agent Data Tools x402',
  description: target.description,
  openapi: ORIGIN + '/openapi.json',
  llms: ORIGIN + '/llms.txt',
  skill: ORIGIN + '/skill.txt',
  resources,
}

const primary =
  resources.find(resource => pathOf(resource.resource) === '/_api/pa-business') ??
  resources[0]
const alias = {
  x402Version: 2,
  resource: {
    url: primary.resource,
    description: primary.description,
    mimeType: 'application/json',
    serviceName: primary.serviceName,
    tags: primary.tags,
  },
  accepts: primary.accepts,
  name: canonical.name,
  description: canonical.description,
  owner_url: ORIGIN,
  facilitator: 'https://facilitator.payai.network',
  resources,
}

const openapi = {
  openapi: '3.1.0',
  info: {
    title: 'Agent Data Tools x402 on Floot',
    version: '2.0.0',
    description: canonical.description,
    'x-guidance':
      'Choose the operation matching the task. All resources use x402 v2 USDC on Base. The vendor-intake gate returns proceed or human_review as a bounded workflow signal, not legal/compliance approval.',
  },
  servers: [{ url: ORIGIN }],
  paths: Object.fromEntries(
    target.resources.map(resource => [pathOf(resource.resource), openApiPath(resource)])
  ),
}

const sitemap =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
  [ORIGIN + '/', ORIGIN + '/openapi.json', ORIGIN + '/.well-known/x402', ORIGIN + '/llms.txt', ORIGIN + '/skill.txt']
    .map(url => '<url><loc>' + url + '</loc></url>')
    .join('') +
  '</urlset>\n'

const files = {
  '.well-known/x402': JSON.stringify(canonical, null, 2) + '\n',
  '.well-known/x402.json': JSON.stringify(alias, null, 2) + '\n',
  '.well-known/x402-services.json': JSON.stringify(alias, null, 2) + '\n',
  'openapi.json': JSON.stringify(openapi, null, 2) + '\n',
  'llms.txt': renderLlms(target.resources, false),
  'llms-full.txt': renderLlms(target.resources, true),
  'skill.txt': renderSkill(target.resources),
  'robots.txt': 'User-agent: *\nAllow: /\nSitemap: ' + ORIGIN + '/sitemap.xml\n',
  'sitemap.xml': sitemap,
}

await mkdir(outDir, { recursive: true })
for (const [relative, content] of Object.entries(files)) {
  const file = resolve(outDir, relative)
  const parent = file.slice(0, file.lastIndexOf('/'))
  await mkdir(parent, { recursive: true })
  await writeFile(file, content, 'utf8')
}

console.log(
  JSON.stringify(
    {
      ok: true,
      outDir,
      resourceCount: resources.length,
      paths: resources.map(resource => pathOf(resource.resource)),
      files: Object.keys(files),
    },
    null,
    2
  )
)
