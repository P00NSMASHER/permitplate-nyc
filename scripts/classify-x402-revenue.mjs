#!/usr/bin/env node

import fs from 'node:fs';

const statusPath =
  process.argv[2] ?? 'verification/pa-entity-directory-status-latest.json';
const rulesPath =
  process.argv[3] ?? 'verification/x402-revenue-attribution-rules.json';
const outputPath =
  process.argv[4] ?? 'verification/x402-revenue-attribution-latest.json';

const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

const lower = value => String(value ?? '').toLowerCase();
const sellerPayTo = lower(rules.seller_pay_to);

const addressSet = key =>
  new Set((rules[key] ?? []).map(entry => lower(entry.address ?? entry)));

const internalPayers = addressSet('known_internal_payers');
const probePayers = addressSet('known_probe_or_verifier_payers');
const customerPayers = addressSet('verified_customer_payers');

function classifyPayer(address) {
  const payer = lower(address);
  if (!payer) return 'missing_payer';
  if (payer === sellerPayTo) return 'self_payment';
  if (internalPayers.has(payer)) return 'known_internal';
  if (probePayers.has(payer)) return 'known_probe_or_verifier';
  if (customerPayers.has(payer)) return 'verified_customer';
  return rules.policy?.unknown_payer ?? 'external_unattributed';
}

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function timestampIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Date(n * 1000).toISOString();
}

const checkedAtMs = Date.parse(status.checked_at);
const incoming = Array.isArray(status.onchain_base_usdc?.incoming)
  ? status.onchain_base_usdc.incoming
  : [];

const resources = [
  {
    key: 'best_match',
    name: 'Pennsylvania Company Identity Best-Match Lookup',
    endpoint: 'https://pa-entity-x402.floot.app/_api/pa-entity-one',
    priceUsd: 0.001,
  },
  {
    key: 'enriched',
    name: 'Pennsylvania Business Registry Search',
    endpoint: 'https://pa-entity-x402.floot.app/_api/pa-business',
    priceUsd: 0.005,
  },
  {
    key: 'vendor_gate',
    name: 'Pennsylvania Vendor Intake Gate',
    endpoint:
      'https://api-v2.appdeploy.ai/app/pa-entity-lookup-x402-4fbm4s/api/vendor-intake-gate',
    priceUsd: 0.02,
  },
];

let observedSettlementsLast24h = 0;
let observedGrossLast24h = 0;
let countedCustomerRevenueLast24h = 0;
let unresolvedSettlementCount = 0;

const resourceReports = {};

for (const resource of resources) {
  const payai = status.payai?.[resource.key];
  const data = payai?.data ?? {};
  const last24h = numeric(data.settlements?.last24h) ?? 0;

  observedSettlementsLast24h += last24h;
  observedGrossLast24h += last24h * resource.priceUsd;

  const exactPriceTransfers = incoming
    .filter(row => {
      const amount = numeric(row.amount_usdc);
      if (amount == null) return false;
      if (Math.abs(amount - resource.priceUsd) > 1e-12) return false;
      const txMs = Number(row.timeStamp) * 1000;
      if (!Number.isFinite(txMs) || !Number.isFinite(checkedAtMs)) return true;
      return txMs <= checkedAtMs && checkedAtMs - txMs <= 24 * 60 * 60 * 1000;
    })
    .map(row => ({
      hash: row.hash ?? null,
      from: row.from ?? null,
      to: row.to ?? null,
      amount_usdc: row.amount_usdc ?? null,
      timestamp: timestampIso(row.timeStamp),
      confirmations: row.confirmations ?? null,
      payer_classification: classifyPayer(row.from),
    }));

  const verifiedCustomerTransfers = exactPriceTransfers.filter(
    row => row.payer_classification === 'verified_customer'
  );

  const countableSettlementCount = Math.min(
    last24h,
    verifiedCustomerTransfers.length
  );
  const countableRevenue = countableSettlementCount * resource.priceUsd;
  countedCustomerRevenueLast24h += countableRevenue;

  const unresolved = Math.max(0, last24h - countableSettlementCount);
  unresolvedSettlementCount += unresolved;

  let attributionState = 'no_settlement_observed';
  if (last24h > 0) {
    if (countableSettlementCount === last24h) {
      attributionState = 'verified_customer_revenue';
    } else if (
      exactPriceTransfers.some(row =>
        ['self_payment', 'known_internal'].includes(row.payer_classification)
      )
    ) {
      attributionState = 'internal_or_self_activity';
    } else if (
      exactPriceTransfers.some(
        row => row.payer_classification === 'known_probe_or_verifier'
      )
    ) {
      attributionState = 'external_verification_activity';
    } else {
      attributionState = 'external_unattributed';
    }
  }

  resourceReports[resource.key] = {
    name: resource.name,
    endpoint: resource.endpoint,
    price_usd: resource.priceUsd,
    payai_resource_matches_endpoint: data.resource === resource.endpoint,
    facilitator: {
      status_ok: payai?.ok === true,
      settlements_last24h: last24h,
      settlements_last7d: data.settlements?.last7d ?? null,
      settlements_last30d: data.settlements?.last30d ?? null,
      settlements_total_bucket: data.settlements?.total ?? null,
      unique_buyers_bucket: data.buyers?.unique ?? null,
      volume_total_usd_bucket: data.volume?.totalUsd ?? null,
      cached_at: data.cachedAt ?? null,
    },
    onchain: {
      exact_price_transfer_candidates_last24h: exactPriceTransfers,
      note:
        'The payout wallet is shared across listings. Exact-price transfers corroborate money movement but do not alone identify the resource or payer purpose.',
    },
    attribution: {
      state: attributionState,
      verified_customer_settlements_last24h: countableSettlementCount,
      unresolved_settlements_last24h: unresolved,
      counted_customer_revenue_usd_last24h: Number(
        countableRevenue.toFixed(6)
      ),
      observed_gross_settlement_value_usd_last24h: Number(
        (last24h * resource.priceUsd).toFixed(6)
      ),
      count_as_revenue: countableSettlementCount > 0,
    },
  };
}

const report = {
  generated_at: new Date().toISOString(),
  source_snapshot: statusPath,
  source_snapshot_checked_at: status.checked_at ?? null,
  policy: {
    unknown_payer:
      rules.policy?.unknown_payer ?? 'external_unattributed',
    count_unknown_as_revenue:
      rules.policy?.count_unknown_as_revenue === true,
    count_probe_or_verifier_as_revenue:
      rules.policy?.count_probe_or_verifier_as_revenue === true,
    count_self_or_internal_as_revenue:
      rules.policy?.count_self_or_internal_as_revenue === true,
    require_resource_specific_settlement_evidence:
      rules.policy?.require_resource_specific_settlement_evidence !== false,
  },
  summary: {
    resource_specific_settlements_observed_last24h:
      observedSettlementsLast24h,
    observed_gross_settlement_value_usd_last24h: Number(
      observedGrossLast24h.toFixed(6)
    ),
    verified_customer_revenue_usd_last24h: Number(
      countedCustomerRevenueLast24h.toFixed(6)
    ),
    unresolved_settlements_last24h: unresolvedSettlementCount,
    revenue_scoreboard_rule:
      'Only verified_customer settlements count as third-party revenue. Unknown external addresses, probes/verifiers, self-payments, tests, registrations and marketplace checks remain excluded.',
  },
  resources: resourceReports,
};

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      output: outputPath,
      summary: report.summary,
      best_match_state: report.resources.best_match.attribution.state,
    },
    null,
    2
  )
);
