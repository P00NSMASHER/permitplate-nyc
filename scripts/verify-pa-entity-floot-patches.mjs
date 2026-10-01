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

const safePatchFiles = [
  'FLOOT_SAFE_PATCH_1_BUSINESS.txt',
  'FLOOT_SAFE_PATCH_2_BEST_MATCH.txt',
  'FLOOT_SAFE_PATCH_3_OPENAPI.txt',
  'FLOOT_SAFE_PATCH_4_AGENT_TEXT.txt',
  'FLOOT_SAFE_PATCH_5_X402_ALIASES.txt',
  'FLOOT_SAFE_PATCH_6_X402_CATALOG.txt',
]

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

const standard = new Map()
for (const name of safePatchFiles) {
  const fullPath = `${root}/${name}`
  const bytes = fs.statSync(fullPath).size
  assert.ok(bytes < 32_000, `${name} is too large for the safe deployment lane: ${bytes} bytes`)
  const parsed = parsePatch(fullPath)
  for (const [target, content] of parsed) {
    assert.ok(!target.includes('_OPTIONS'), `unsupported Floot OPTIONS endpoint leaked into deploy patch: ${target}`)
    assert.ok(!standard.has(target), `duplicate Floot target across safe patches: ${target}`)
    standard.set(target, content)
  }
}

assert.equal(standard.size, 14, 'six standard safe patches must contain exactly 14 unique Floot files')

for (const [target, fixture] of Object.entries(mapping)) {
  assert.ok(standard.has(target), `missing Floot target ${target}`)
  const actual = standard.get(target)
  const expected = fs.readFileSync(`${root}/${fixture}`, 'utf8').replace(/\r\n/g, '\n')
  assert.equal(actual, expected, `safe patch drift for ${target} vs ${fixture}`)
}

for (const target of standard.keys()) {
  assert.ok(mapping[target], `unexpected Floot target in safe patches: ${target}`)
}

const extensionlessPath = `${root}/FLOOT_SAFE_PATCH_7_EXTENSIONLESS.txt`
assert.ok(fs.statSync(extensionlessPath).size < 16_000, 'extensionless patch unexpectedly large')
const extensionless = parsePatch(extensionlessPath)
assert.equal(extensionless.size, 1, 'extensionless patch must contain exactly one file')
assert.ok(extensionless.has('static/.well-known/x402'))
assert.equal(
  extensionless.get('static/.well-known/x402'),
  fs.readFileSync(`${root}/x402`, 'utf8').replace(/\r\n/g, '\n'),
  'extensionless x402 patch drift',
)

const fingerprintEntries = [
  ...Object.entries(mapping),
  ['static/.well-known/x402', 'x402'],
]

const fingerprintInput = fingerprintEntries
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

console.log('PA Entity Floot safe patch parity: 15/15 exact')
console.log('SAFE_PATCH_COUNT=7')
console.log('STANDARD_DEPLOY_FILES=14')
console.log('EXTENSIONLESS_DEPLOY_FILES=1')
console.log('FLOOT_RELEASE_FINGERPRINT=' + fingerprint)
