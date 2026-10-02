import { readFile, writeFile } from 'node:fs/promises';

const target = JSON.parse(
  await readFile(new URL('../recovery/floot-target-manifest.json', import.meta.url), 'utf8')
);

const LIVE_URL = 'https://pa-entity-x402.floot.app/.well-known/x402';

const response = await fetch(LIVE_URL, {
  headers: {
    accept: 'application/json',
    'user-agent': 'x402-floot-manifest-comparator/1.0',
  },
  signal: AbortSignal.timeout(15000),
});

if (!response.ok) {
  throw new Error('Floot manifest returned HTTP ' + response.status);
}

const live = await response.json();
if (live?.x402Version !== 2) {
  throw new Error('Floot manifest is not x402Version 2');
}

const toPath = (value) => new URL(value).pathname;
const targetByPath = new Map(
  target.resources.map((resource) => [toPath(resource.resource), resource])
);
const liveByPath = new Map(
  (live.resources ?? []).map((resource) => [toPath(resource.resource), resource])
);

const present = [];
const missing = [];
const mismatched = [];

for (const [path, expected] of targetByPath) {
  const actual = liveByPath.get(path);
  if (!actual) {
    missing.push(path);
    continue;
  }

  const expectedTerms = expected.accepts?.[0] ?? {};
  const actualTerms = actual.accepts?.[0] ?? {};
  const failures = [];

  if (actual.price !== expected.price) {
    failures.push(`price=${actual.price} expected=${expected.price}`);
  }
  if (String(actualTerms.amount) !== String(expectedTerms.amount)) {
    failures.push(
      `amount=${String(actualTerms.amount)} expected=${String(expectedTerms.amount)}`
    );
  }
  if (actualTerms.network !== expectedTerms.network) {
    failures.push(
      `network=${String(actualTerms.network)} expected=${String(expectedTerms.network)}`
    );
  }
  if (
    String(actualTerms.asset ?? '').toLowerCase() !==
    String(expectedTerms.asset ?? '').toLowerCase()
  ) {
    failures.push('asset mismatch');
  }
  if (
    String(actualTerms.payTo ?? '').toLowerCase() !==
    String(expectedTerms.payTo ?? '').toLowerCase()
  ) {
    failures.push('payTo mismatch');
  }

  if (failures.length) mismatched.push({ path, failures });
  else present.push(path);
}

const unexpected = [...liveByPath.keys()].filter((path) => !targetByPath.has(path));

const report = {
  checkedAt: new Date().toISOString(),
  liveUrl: LIVE_URL,
  liveResourceCount: liveByPath.size,
  targetResourceCount: targetByPath.size,
  present,
  missing,
  mismatched,
  unexpected,
  complete:
    missing.length === 0 &&
    mismatched.length === 0 &&
    unexpected.length === 0 &&
    liveByPath.size === targetByPath.size,
};

const reportJson = JSON.stringify(report, null, 2);
console.log(reportJson);

const reportPath = process.env.REPORT_PATH?.trim();
if (reportPath) {
  await writeFile(reportPath, reportJson + '\n', 'utf8');
}

if (process.env.REQUIRE_COMPLETE === '1' && !report.complete) {
  process.exitCode = 1;
}
