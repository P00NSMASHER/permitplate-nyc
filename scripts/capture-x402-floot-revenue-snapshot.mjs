#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

const target = JSON.parse(
  await readFile(
    new URL('../recovery/x402-portfolio-target.json', import.meta.url),
    'utf8'
  )
);

const ORIGIN = target.origin;
const PAY_TO = target.payTo;
const USDC = target.asset;

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

async function jsonFetch(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'x402-floot-revenue-snapshot/1.0',
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    url,
    data,
    body: data == null ? text.slice(0, 4000) : undefined,
  };
}

const manifest = await jsonFetch(ORIGIN + '/.well-known/x402');
if (
  manifest.status !== 200 ||
  manifest.data?.x402Version !== 2 ||
  !Array.isArray(manifest.data?.resources) ||
  manifest.data.resources.length !== 8
) {
  throw new Error(
    'Refusing revenue snapshot: Floot is not in verified 8-resource state'
  );
}

const payai = {};
for (const resource of target.resources) {
  const key = statusKeyById[resource.id] ?? resource.id;
  const endpoint = ORIGIN + resource.path;
  const encoded = encodeURIComponent(endpoint);
  payai[key] = await jsonFetch(
    'https://facilitator.payai.network/discovery/resources/' +
      encoded +
      '/stats'
  );
}

const onchainUrl = new URL('https://base.blockscout.com/api');
onchainUrl.searchParams.set('module', 'account');
onchainUrl.searchParams.set('action', 'tokentx');
onchainUrl.searchParams.set('address', PAY_TO);
onchainUrl.searchParams.set('contractaddress', USDC);
onchainUrl.searchParams.set('page', '1');
onchainUrl.searchParams.set('offset', '100');
onchainUrl.searchParams.set('sort', 'desc');

const onchain = await jsonFetch(onchainUrl.toString());
const incoming = [];

if (onchain.ok && Array.isArray(onchain.data?.result)) {
  for (const row of onchain.data.result) {
    if (String(row?.to ?? '').toLowerCase() !== String(PAY_TO).toLowerCase()) {
      continue;
    }
    let amount = null;
    try {
      const decimals = Number.parseInt(String(row?.tokenDecimal ?? '6'), 10);
      amount = Number(BigInt(String(row?.value ?? '0'))) / 10 ** decimals;
    } catch {
      amount = null;
    }
    incoming.push({
      hash: row?.hash ?? null,
      from: row?.from ?? null,
      to: row?.to ?? null,
      amount_usdc: amount,
      timeStamp: row?.timeStamp ?? null,
      confirmations: row?.confirmations ?? null,
      tokenSymbol: row?.tokenSymbol ?? null,
    });
  }
}

const snapshot = {
  checked_at: new Date().toISOString(),
  mode: 'post_floot_rehost_zero_spend_revenue_snapshot',
  origin: ORIGIN,
  manifest: {
    status: manifest.status,
    resourceCount: manifest.data.resources.length,
  },
  payai,
  onchain_base_usdc: {
    ok: onchain.ok,
    status: onchain.status,
    url: onchain.url,
    incoming,
    note:
      'Wallet-level evidence only. Resource attribution requires exact resource-specific facilitator stats plus payer provenance rules.',
  },
  accounting_note:
    'This snapshot does not classify revenue. Unknown external payers, marketplace probes, tests, self-payments and seller-funded activity remain excluded until classification.',
};

const json = JSON.stringify(snapshot, null, 2);
console.log(
  JSON.stringify(
    {
      checked_at: snapshot.checked_at,
      resources: Object.keys(payai).length,
      payai_ok: Object.values(payai).filter(entry => entry.ok).length,
      incoming_transfers: incoming.length,
    },
    null,
    2
  )
);

const output =
  process.env.REPORT_PATH?.trim() ||
  'verification/x402-floot-revenue-snapshot-latest.json';
await writeFile(output, json + '\n', 'utf8');
