import assert from 'node:assert/strict'
import fs from 'node:fs'

const path = 'docs/pa-entity-floot-release/vendor-intake-demo_GET.ts'
const schemaPath =
  'docs/pa-entity-floot-release/vendor-intake-demo_GET.schema.ts'

const source = fs.readFileSync(path, 'utf8')
const schema = fs.readFileSync(schemaPath, 'utf8')

assert.ok(source.includes("from './vendor-intake-gate_GET'"))
assert.ok(source.includes("type DemoCase = 'proceed' | 'address_mismatch' | 'domain_mismatch'"))
assert.ok(source.includes("rawCase !== 'proceed'"))
assert.ok(source.includes("rawCase !== 'address_mismatch'"))
assert.ok(source.includes("rawCase !== 'domain_mismatch'"))
assert.ok(source.includes("error: 'unknown_fixture'"))
assert.ok(source.includes('allowedCases:'))
assert.ok(source.includes('Fixed reviewer fixture only.'))
assert.ok(
  source.includes(
    'Arbitrary vendor checks require the paid /_api/vendor-intake-gate endpoint.'
  )
)
assert.ok(source.includes('const result = await runVendorGate(input)'))
assert.ok(source.includes('demo: true'))
assert.ok(source.includes('paid: false'))
assert.ok(source.includes('sampleInput: true'))

assert.ok(
  schema.includes(
    "z.enum(['proceed', 'address_mismatch', 'domain_mismatch']).optional()"
  )
)

const forbidden = [
  "url.searchParams.get('name')",
  "url.searchParams.get('address')",
  "url.searchParams.get('domain')",
]
for (const needle of forbidden) {
  assert.equal(
    source.includes(needle),
    false,
    'fixed demo must not accept arbitrary vendor input via ' + needle
  )
}

console.log('PASS fixed Floot vendor-gate reviewer wrapper is bounded to 3 cases')
