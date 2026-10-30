#!/usr/bin/env node

import fs from 'node:fs';

const statusPath =
  process.argv[2] ?? 'verification/pa-entity-directory-status-latest.json';
const rulesPath =
  process.argv[3] ?? 'verification/x402-revenue-attribution-rules.json';
const outputPath =
  process.argv[4] ?? 'verification/x402-revenue-attribution-latest.json';
const targetPath =
  process.argv[5] ?? 'recovery/x402-portfolio-target.json';

const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));

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

const statusKeyById = {
  'pa-best-match': 'best_match',
  'pa-enriched-search': 'enriched',
  'vendor-intake-gate': 'vendor_gate',
  'sec-recent-filings': 'sec',
  'census-geocoder': 'census',
  'ofac-sdn-screen': 'ofac',
  'domain-rdap': 'rdap',
  'treasury-average-rates': 'treasury',
};

const resources = (target.resources ?? []).map(resource => ({
  id: resource.id,
  key: statusKeyById[resource.id] ?? resource.id,
  name: resource.name,
  endpoint: target.origin + resource.path,
  priceUsd: Number(String(resource.price).replace('$', '')),
}));

if (resources.length !== 8) {
  throw new Error('Expected 8 resources in x402 portfolio target');
}

function exactPriceTransfers(priceUsd) {
  return incoming
    .filter(row => {
      const amount = numeric(row.amount_usdc);
      if (amount == null) return false;
      if (Math.abs(amount - priceUsd) > 1e-12) return false;
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
}

const effectiveById = new Map();

for (const resource of resources) {
  const payai = status.payai?.[resource.key];
  const data = payai?.data ?? {};
  const rawLast24h = numeric(data.settlements?.last24h) ?? 0;
  const resourceMatchesEndpoint = data.resource === resource.endpoint;
  const statsUsable =
    payai?.ok === true &&
    resourceMatchesEndpoint;

  effectiveById.set(resource.id, {
    payai,
    data,
    rawLast24h,
    resourceMatchesEndpoint,
    statsUsable,
    effectiveLast24h: statsUsable ? rawLast24h : 0,
  });
}

const priceGroups = new Map();
for (const resource of resources) {
  const key = resource.priceUsd.toFixed(6);
  const list = priceGroups.get(key) ?? [];
  list.push(resource);
  priceGroups.set(key, list);
}

let observedSettlementsLast24h = 0;
let observedGrossLast24h = 0;
let countedCustomerRevenueLast24h = 0;
let unresolvedSettlementCount = 0;

const groupReports = {};
const perResourceAllocation = new Map();

for (const [priceKey, groupResources] of priceGroups) {
  const priceUsd = Number(priceKey);
  const active = groupResources.filter(
    resource => (effectiveById.get(resource.id)?.effectiveLast24h ?? 0) > 0
  );
  const totalSettlements = groupResources.reduce(
    (sum, resource) =>
      sum + (effectiveById.get(resource.id)?.effectiveLast24h ?? 0),
    0
  );
  const transfers = exactPriceTransfers(priceUsd);
  const verifiedCustomerTransfers = transfers.filter(
    row => row.payer_classification === 'verified_customer'
  );

  observedSettlementsLast24h += totalSettlements;
  observedGrossLast24h += totalSettlements * priceUsd;

  let countableSettlements = 0;
  let allocationState = 'no_settlement_observed';

  if (totalSettlements > 0) {
    if (active.length === 1) {
      countableSettlements = Math.min(
        totalSettlements,
        verifiedCustomerTransfers.length
      );
      allocationState =
        countableSettlements > 0
          ? 'single_resource_verified_customer'
          : 'single_resource_unattributed';
    } else {
      allocationState =
        verifiedCustomerTransfers.length > 0
          ? 'same_price_multi_resource_ambiguous'
          : 'same_price_multi_resource_unattributed';
    }
  }

  countedCustomerRevenueLast24h += countableSettlements * priceUsd;
  unresolvedSettlementCount += Math.max(
    0,
    totalSettlements - countableSettlements
  );

  if (active.length === 1) {
    perResourceAllocation.set(active[0].id, countableSettlements);
  }

  groupReports[priceKey] = {
    price_usd: priceUsd,
    resources: groupResources.map(resource => resource.id),
    active_resources_last24h: active.map(resource => resource.id),
    resource_specific_settlements_last24h: totalSettlements,
    verified_customer_transfer_candidates_last24h:
      verifiedCustomerTransfers.length,
    countable_verified_customer_settlements_last24h: countableSettlements,
    counted_customer_revenue_usd_last24h: Number(
      (countableSettlements * priceUsd).toFixed(6)
    ),
    allocation_state: allocationState,
    note:
      active.length > 1
        ? 'Multiple resources share this price and reported settlements. Amount-only wallet transfers are not assigned to individual resources.'
        : 'A settlement can be attributed only when exact resource stats match the endpoint and customer provenance is verified.',
  };
}

const resourceReports = {};

for (const resource of resources) {
  const info = effectiveById.get(resource.id);
  const data = info.data;
  const last24h = info.effectiveLast24h;
  const transfers = exactPriceTransfers(resource.priceUsd);
  const verifiedCustomerTransfers = transfers.filter(
    row => row.payer_classification === 'verified_customer'
  );
  const allocatedCustomerSettlements =
    perResourceAllocation.get(resource.id) ?? 0;

  let attributionState = 'no_settlement_observed';

  if (!info.statsUsable && info.rawLast24h > 0) {
    attributionState = 'stale_or_mismatched_resource_stats';
  } else if (last24h > 0) {
    const samePriceGroup = priceGroups.get(resource.priceUsd.toFixed(6)) ?? [];
    const activeSamePrice = samePriceGroup.filter(
      item => (effectiveById.get(item.id)?.effectiveLast24h ?? 0) > 0
    );

    if (allocatedCustomerSettlements > 0) {
      attributionState = 'verified_customer_revenue';
    } else if (activeSamePrice.length > 1) {
      attributionState = 'same_price_group_unresolved';
    } else if (
      transfers.some(row =>
        ['self_payment', 'known_internal'].includes(row.payer_classification)
      )
    ) {
      attributionState = 'internal_or_self_activity';
    } else if (
      transfers.some(
        row => row.payer_classification === 'known_probe_or_verifier'
      )
    ) {
      attributionState = 'external_verification_activity';
    } else {
      attributionState = 'external_unattributed';
    }
  }

  const countableRevenue =
    allocatedCustomerSettlements * resource.priceUsd;

  resourceReports[resource.key] = {
    id: resource.id,
    name: resource.name,
    endpoint: resource.endpoint,
    price_usd: resource.priceUsd,
    payai_resource_matches_endpoint: info.resourceMatchesEndpoint,
    facilitator: {
      status_ok: info.payai?.ok === true,
      stats_usable_for_attribution: info.statsUsable,
      reported_resource: data.resource ?? null,
      raw_settlements_last24h: info.rawLast24h,
      settlements_last24h: last24h,
      settlements_last7d: data.settlements?.last7d ?? null,
      settlements_last30d: data.settlements?.last30d ?? null,
      settlements_total_bucket: data.settlements?.total ?? null,
      unique_buyers_bucket: data.buyers?.unique ?? null,
      volume_total_usd_bucket: data.volume?.totalUsd ?? null,
      cached_at: data.cachedAt ?? null,
    },
    onchain: {
      exact_price_transfer_candidates_last24h: transfers,
      verified_customer_transfer_candidates_last24h:
        verifiedCustomerTransfers.length,
      note:
        'The payout wallet is shared across listings. Exact-price transfers corroborate money movement but do not alone identify the resource or payer purpose.',
    },
    attribution: {
      state: attributionState,
      verified_customer_settlements_last24h:
        allocatedCustomerSettlements,
      unresolved_settlements_last24h: Math.max(
        0,
        last24h - allocatedCustomerSettlements
      ),
      counted_customer_revenue_usd_last24h: Number(
        countableRevenue.toFixed(6)
      ),
      observed_gross_settlement_value_usd_last24h: Number(
        (last24h * resource.priceUsd).toFixed(6)
      ),
      count_as_revenue: allocatedCustomerSettlements > 0,
    },
  };
}

const report = {
  generated_at: new Date().toISOString(),
  source_snapshot: statusPath,
  source_snapshot_checked_at: status.checked_at ?? null,
  portfolio_target: targetPath,
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
    same_price_multi_resource_rule:
      'When multiple resources sharing one price report settlements, amount-only wallet transfers are not allocated to individual resources and remain unresolved.',
  },
  summary: {
    portfolio_resources: resources.length,
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
      'Only settlements supported by exact resource stats and verified customer provenance count as third-party revenue. Same-price multi-resource ambiguity, unknown external addresses, probes/verifiers, self-payments, tests, registrations and marketplace checks remain excluded.',
  },
  price_groups: groupReports,
  resources: resourceReports,
};

fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');

console.log(
  JSON.stringify(
    {
      output: outputPath,
      summary: report.summary,
      best_match_state: report.resources.best_match?.attribution.state ?? null,
      vendor_gate_state: report.resources.vendor_gate?.attribution.state ?? null,
    },
    null,
    2
  )
);
