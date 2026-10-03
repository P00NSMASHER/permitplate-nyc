#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const classifier = fileURLToPath(
  new URL('./classify-x402-revenue.mjs', import.meta.url)
);
const targetPath = fileURLToPath(
  new URL('../recovery/x402-portfolio-target.json', import.meta.url)
);
const workflowPath = fileURLToPath(
  new URL('../.github/workflows/x402-revenue-attribution.yml', import.meta.url)
);

function baseRules(verifiedCustomers = []) {
  return {
    version: 1,
    seller_pay_to: '0x708f7b52b56eafd7fc1de65fc7752ed732914021',
    policy: {
      unknown_payer: 'external_unattributed',
      count_unknown_as_revenue: false,
      count_probe_or_verifier_as_revenue: false,
      count_self_or_internal_as_revenue: false,
      require_resource_specific_settlement_evidence: true,
    },
    known_internal_payers: [],
    known_probe_or_verifier_payers: [],
    verified_customer_payers: verifiedCustomers,
  };
}

function runCase(name, status, rules) {
  const dir = mkdtempSync(join(tmpdir(), 'x402-revenue-test-'));
  const statusPath = join(dir, 'status.json');
  const rulesPath = join(dir, 'rules.json');
  const outputPath = join(dir, 'output.json');
  writeFileSync(statusPath, JSON.stringify(status));
  writeFileSync(rulesPath, JSON.stringify(rules));

  execFileSync(
    process.execPath,
    [classifier, statusPath, rulesPath, outputPath, targetPath],
    { stdio: 'pipe' }
  );

  const report = JSON.parse(readFileSync(outputPath, 'utf8'));
  console.log('PASS ' + name);
  return report;
}

const checkedAt = '2026-10-02T16:00:00.000Z';
const verifiedPayer = '0x1111111111111111111111111111111111111111';

{
  const status = {
    checked_at: checkedAt,
    payai: {
      best_match: {
        ok: true,
        data: {
          resource: 'https://pa-entity-x402.floot.app/_api/pa-entity-one',
          settlements: { last24h: 1 },
        },
      },
    },
    onchain_base_usdc: {
      incoming: [
        {
          hash: '0xaaa',
          from: verifiedPayer,
          to: '0x708f7b52b56eafd7fc7752ed732914021',
          amount_usdc: 0.001,
          timeStamp: String(Date.parse(checkedAt) / 1000 - 60),
        },
      ],
    },
  };

  const report = runCase(
    'unique-price verified customer counts once',
    status,
    baseRules([verifiedPayer])
  );
  assert.equal(report.summary.verified_customer_revenue_usd_last24h, 0.001);
  assert.equal(
    report.resources.best_match.attribution.verified_customer_settlements_last24h,
    1
  );
  assert.equal(report.resources.best_match.attribution.count_as_revenue, true);
}

{
  const status = {
    checked_at: checkedAt,
    payai: {
      sec: {
        ok: true,
        data: {
          resource: 'https://pa-entity-x402.floot.app/_api/sec-filings',
          settlements: { last24h: 1 },
        },
      },
      census: {
        ok: true,
        data: {
          resource: 'https://pa-entity-x402.floot.app/_api/us-address-geocode',
          settlements: { last24h: 1 },
        },
      },
    },
    onchain_base_usdc: {
      incoming: [
        {
          hash: '0xbbb',
          from: verifiedPayer,
          to: '0x708f7b52b56eafd7fc7752ed732914021',
          amount_usdc: 0.005,
          timeStamp: String(Date.parse(checkedAt) / 1000 - 60),
        },
        {
          hash: '0xccc',
          from: verifiedPayer,
          to: '0x708f7b52b56eafd7fc7752ed732914021',
          amount_usdc: 0.005,
          timeStamp: String(Date.parse(checkedAt) / 1000 - 120),
        },
      ],
    },
  };

  const report = runCase(
    'same-price multi-resource settlements remain unresolved',
    status,
    baseRules([verifiedPayer])
  );
  assert.equal(report.summary.verified_customer_revenue_usd_last24h, 0);
  assert.equal(report.summary.unresolved_settlements_last24h, 2);
  assert.equal(
    report.price_groups['0.005000'].allocation_state,
    'same_price_multi_resource_ambiguous'
  );
  assert.equal(report.resources.sec.attribution.count_as_revenue, false);
  assert.equal(report.resources.census.attribution.count_as_revenue, false);
}

{
  const status = {
    checked_at: checkedAt,
    payai: {
      vendor_gate: {
        ok: true,
        data: {
          resource:
            'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate',
          settlements: { last24h: 1 },
        },
      },
    },
    onchain_base_usdc: {
      incoming: [
        {
          hash: '0xddd',
          from: verifiedPayer,
          to: '0x708f7b52b56eafd7fc7752ed732914021',
          amount_usdc: 0.02,
          timeStamp: String(Date.parse(checkedAt) / 1000 - 60),
        },
      ],
    },
  };

  const report = runCase(
    'stale old-host stats never count toward Floot resource',
    status,
    baseRules([verifiedPayer])
  );
  assert.equal(report.summary.verified_customer_revenue_usd_last24h, 0);
  assert.equal(report.summary.resource_specific_settlements_observed_last24h, 0);
  assert.equal(
    report.resources.vendor_gate.attribution.state,
    'stale_or_mismatched_resource_stats'
  );
  assert.equal(
    report.resources.vendor_gate.facilitator.stats_usable_for_attribution,
    false
  );
}

console.log('PASS x402 revenue attribution safety suite');

{
  const workflow = readFileSync(workflowPath, 'utf8');
  const captureStep = workflow.indexOf(
    'node scripts/capture-x402-floot-revenue-snapshot.mjs'
  );
  const classifyStep = workflow.indexOf(
    'node scripts/classify-x402-revenue.mjs'
  );

  assert.ok(captureStep >= 0, 'revenue workflow must capture fresh Floot evidence');
  assert.ok(
    classifyStep > captureStep,
    'revenue workflow must capture fresh evidence before classification'
  );
  assert.match(
    workflow,
    /verification\/x402-floot-revenue-snapshot-latest\.json/,
    'revenue workflow must classify the verified eight-route snapshot'
  );
  assert.match(
    workflow,
    /git add "\$SNAPSHOT" "\$RECEIPT"/,
    'revenue workflow must persist the source snapshot with its classification'
  );

  console.log('PASS revenue workflow cannot publish attribution from stale directory status');
}
