#!/usr/bin/env node
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const plan = JSON.parse(
  await readFile(new URL('../recovery/floot-reset-deploy-plan.json', import.meta.url), 'utf8')
)

assert.equal(plan.projectId, 'b69a3ee6-eb01-430d-aa51-da2fc7beeac4')
assert.equal(plan.productionOrigin, 'https://pa-entity-x402.floot.app')
assert.equal(plan.invariants.spendUsd, 0)
assert.equal(plan.invariants.expectedPaidResources, 8)
assert.equal(plan.invariants.expectedReviewerFixtures, 3)
assert.equal(plan.endpointWrites.length, 7)
assert.equal(plan.schemaBatch.files.length, 7)
assert.equal(plan.discoveryGeneration.expectedFiles, 11)
assert.equal(plan.discoveryGeneration.largeWrites.length, 5)
assert.equal(plan.discoveryGeneration.smallBatch.files.length, 6)
assert.equal(plan.estimatedBuildActions.total, 18)
assert.equal(plan.preserveWithoutRewrite.length, 4)

for (const item of plan.endpointWrites) await access(item.fixture)
for (const item of plan.schemaBatch.files) await access(item.fixture)
await access('scripts/generate-floot-recovery-discovery.mjs')

const targets = [
  ...plan.preserveWithoutRewrite,
  ...plan.endpointWrites.map(item => item.target),
  ...plan.schemaBatch.files.map(item => item.target),
  ...plan.discoveryGeneration.largeWrites.map(item => item.target),
  ...plan.discoveryGeneration.smallBatch.files.map(item => item.target),
]
assert.equal(new Set(targets).size, targets.length, 'duplicate Floot deployment target')

assert.equal(
  plan.endpointWrites.some(item => item.target.includes('pa-entity-one') || item.target.includes('pa-business')),
  false,
  'existing PA paid endpoints must not be rewritten in outage recovery'
)

console.log('PASS Floot reset deployment plan: 18 estimated build actions, 8 paid routes, 3 reviewer fixtures')
