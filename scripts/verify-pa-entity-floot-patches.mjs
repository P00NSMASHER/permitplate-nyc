#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import crypto from 'node:crypto'

const root = 'docs/pa-entity-floot-release'

const mapping = {
  'endpoints/pa-business_GET.ts': 'pa-business_GET.ts',
  'endpoints/pa-business_GET.schema.ts': 'pa-business_GET.schema.ts',
  'endpoints/pa-entity-one_GET.ts': 'pa-entity-one_GET.ts',
  'endpoints/pa-entity-one_GET.schema.ts': 'pa-entity-one_GET.schema.ts',
  'endpoints/pa-business_OPTIONS.ts': 'pa-business_OPTIONS.ts',
  'endpoints/pa-business_OPTIONS.schema.ts': 'pa-business_OPTIONS.schema.ts',
  'endpoints/pa-entity-one_OPTIONS.ts': 'pa-entity-one_OPTIONS.ts',
  'endpoints/pa-entity-one_OPTIONS.schema.ts': 'pa-entity-one_OPTIONS.schema.ts',
  'static/openapi.json': 'openapi.json',
  'static/llms.txt': 'llms.txt',
  'static/llms-full.txt': 'llms-full.txt',
  'static/skill.txt': 'skill.txt',
  'static/.well-known/x402.json': 'x402.json',
  'static/.well-known/x402-services.json': 'x402-services.json',
  'static/.well-known/x402-service.json': 'x402-service.json',
  'static/.well-known/x402-catalog.json': 'x402-catalog.json',
  'static/.well-known/security.txt': 'security.txt',
  'static/sitemap.xml': 'sitemap.xml',
}

function parsePatch(path) {
  const text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const files = new Map()
  let current = null
  let buffer = []

  const flush = () => {
    if (!current) return
    const content = buffer.map(line => {
      assert.ok(line.startsWith('+'), `non-add line in ${current}: ${line.slice(0,80)}`)
      return line.slice(1)
    }).join('\n')
    files.set(current, content.endsWith('\n') ? content : content + '\n')
    current = null
    buffer = []
  }

  for (const line of lines) {
    if (line.startsWith('*** Add File: ')) {
      flush()
      current = line.slice('*** Add File: '.length)
      continue
    }
    if (line === '*** End Patch') {
      flush()
      break
    }
    if (current) buffer.push(line)
  }
  return files
}

const core = parsePatch(`${root}/FLOOT_PATCH_CORE.txt`)
const discovery = parsePatch(`${root}/FLOOT_PATCH_DISCOVERY.txt`)
const combined = new Map([...core, ...discovery])

assert.equal(core.size, 8, 'core patch must contain exactly 8 Floot files')
assert.equal(discovery.size, 10, 'discovery patch must contain exactly 10 Floot files')
assert.equal(combined.size, 18, 'combined patch must contain exactly 18 unique Floot files')

for (const [target, fixture] of Object.entries(mapping)) {
  assert.ok(combined.has(target), `missing Floot target ${target}`)
  const actual = combined.get(target)
  const expected = fs.readFileSync(`${root}/${fixture}`, 'utf8').replace(/\r\n/g, '\n')
  assert.equal(actual, expected, `patch drift for ${target} vs ${fixture}`)
}

for (const target of combined.keys()) {
  assert.ok(mapping[target], `unexpected Floot target in patch: ${target}`)
}


const safePatchNames = [
  'FLOOT_SAFE_PATCH_1_BUSINESS.txt',
  'FLOOT_SAFE_PATCH_2_BEST_MATCH.txt',
  'FLOOT_SAFE_PATCH_3_OPENAPI.txt',
  'FLOOT_SAFE_PATCH_4_AGENT_TEXT.txt',
  'FLOOT_SAFE_PATCH_5_X402_ALIASES.txt',
  'FLOOT_SAFE_PATCH_6_X402_CATALOG.txt',
]

const safeCombined = new Map()
for (const name of safePatchNames) {
  const parsed = parsePatch(`${root}/${name}`)
  for (const [target, content] of parsed) {
    assert.ok(!safeCombined.has(target), `duplicate safe-patch target: ${target}`)
    safeCombined.set(target, content)
  }
}

assert.equal(safeCombined.size, 18, 'safe patches 1-6 must contain exactly 18 unique Floot files')
for (const [target, fixture] of Object.entries(mapping)) {
  assert.ok(safeCombined.has(target), `safe patches missing Floot target ${target}`)
  const actual = safeCombined.get(target)
  const expected = fs.readFileSync(`${root}/${fixture}`, 'utf8').replace(/\r\n/g, '\n')
  assert.equal(actual, expected, `safe patch drift for ${target} vs ${fixture}`)
}

const extensionless = parsePatch(`${root}/FLOOT_SAFE_PATCH_7_EXTENSIONLESS.txt`)
assert.deepEqual(
  [...extensionless.keys()],
  ['static/.well-known/x402'],
  'safe patch 7 must contain only the extensionless canonical x402 manifest',
)
assert.equal(
  extensionless.get('static/.well-known/x402'),
  fs.readFileSync(`${root}/x402.json`, 'utf8').replace(/\r\n/g, '\n'),
  'extensionless canonical x402 patch must equal x402.json exactly',
)

const fingerprintInput = Object.entries(mapping)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([target, fixture]) => {
    const bytes = fs.readFileSync(`${root}/${fixture}`)
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    return `${target}\0${sha}`
  })
  .join('\n')

const fingerprint = crypto
  .createHash('sha256')
  .update(fingerprintInput)
  .digest('hex')

console.log('PA Entity Floot atomic patch parity: 18/18 exact')
console.log('PA Entity Floot safe patch parity: 18/18 exact + canonical extensionless exact')
console.log('FLOOT_RELEASE_FINGERPRINT=' + fingerprint)
