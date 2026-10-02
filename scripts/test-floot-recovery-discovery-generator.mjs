#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const out = await mkdtemp(join(tmpdir(), 'floot-discovery-'))
const run = spawnSync(
  process.execPath,
  ['scripts/generate-floot-recovery-discovery.mjs', '--out-dir', out],
  { encoding: 'utf8' }
)
assert.equal(run.status, 0, run.stderr || run.stdout)

const canonical = JSON.parse(await readFile(join(out, '.well-known/x402'), 'utf8'))
const openapi = JSON.parse(await readFile(join(out, 'openapi.json'), 'utf8'))
const alias = JSON.parse(await readFile(join(out, '.well-known/x402.json'), 'utf8'))
const services = JSON.parse(
  await readFile(join(out, '.well-known/x402-services.json'), 'utf8')
)
const llms = await readFile(join(out, 'llms-full.txt'), 'utf8')
const skill = await readFile(join(out, 'skill.txt'), 'utf8')

assert.equal(canonical.x402Version, 2)
assert.equal(canonical.resources.length, 8)
assert.equal(Object.keys(openapi.paths).length, 8)
assert.equal(alias.resources.length, 8)
assert.equal(services.resources.length, 8)

const expected = new Map([
  ['/_api/pa-entity-one', ['1000', '$0.001']],
  ['/_api/pa-business', ['5000', '$0.005']],
  ['/_api/vendor-intake-gate', ['20000', '$0.020']],
  ['/_api/sec-filings', ['5000', '$0.005']],
  ['/_api/us-address-geocode', ['5000', '$0.005']],
  ['/_api/ofac-sdn-screen', ['5000', '$0.005']],
  ['/_api/domain-rdap', ['5000', '$0.005']],
  ['/_api/treasury-average-rates', ['5000', '$0.005']],
])

for (const resource of canonical.resources) {
  const path = new URL(resource.resource).pathname
  assert(expected.has(path), 'unexpected resource ' + path)
  const [amount, price] = expected.get(path)
  assert.equal(String(resource.accepts?.[0]?.amount), amount)
  assert.equal(resource.price, price)
  assert.equal(resource.accepts?.[0]?.network, 'eip155:8453')
  assert.equal(
    String(resource.accepts?.[0]?.asset).toLowerCase(),
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  )
  assert.equal(
    String(resource.accepts?.[0]?.payTo).toLowerCase(),
    '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
  )
  assert.equal(resource.accepts?.[0]?.extra?.name, 'USD Coin')
  assert.equal(resource.serviceName.length <= 32, true)
  assert.equal(resource.tags.length <= 5, true)
}

assert.equal(
  openapi.paths['/_api/vendor-intake-gate'].get.operationId,
  'checkPennsylvaniaVendorIntakeGate'
)
assert.match(llms, /proceed or human_review/)
assert.match(skill, /not legal advice, sanctions clearance/i)

for (const content of [
  JSON.stringify(canonical),
  JSON.stringify(openapi),
  JSON.stringify(alias),
  JSON.stringify(services),
  llms,
  skill,
]) {
  assert.equal(content.includes('api-v2.appdeploy.ai'), false)
}

console.log('PASS generated Floot discovery bundle: 8 resources / 9 files / no AppDeploy runtime URLs')
