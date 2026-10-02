import { readFile } from 'node:fs/promises';

const raw = await readFile(
  new URL('../recovery/x402-portfolio-target.json', import.meta.url),
  'utf8'
);
const manifest = JSON.parse(raw);
const failures = [];
const printableAscii32 = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 32 &&
  /^[\\x20-\\x7E]+$/.test(value);

const expected = new Map([
  ['pa-best-match', ['$0.001', '1000']],
  ['pa-enriched-search', ['$0.005', '5000']],
  ['vendor-intake-gate', ['$0.020', '20000']],
  ['sec-recent-filings', ['$0.005', '5000']],
  ['census-geocoder', ['$0.005', '5000']],
  ['ofac-sdn-screen', ['$0.005', '5000']],
  ['domain-rdap', ['$0.005', '5000']],
  ['treasury-average-rates', ['$0.005', '5000']],
]);

if (manifest.network !== 'eip155:8453') failures.push('wrong network');
if (
  String(manifest.asset).toLowerCase() !==
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
) failures.push('wrong Base USDC asset');
if (
  String(manifest.payTo).toLowerCase() !==
  '0x708f7b52b56eafd7fc1de65fc7752ed732914021'
) failures.push('wrong payout wallet');

const resources = Array.isArray(manifest.resources) ? manifest.resources : [];
if (resources.length !== 8) failures.push('expected exactly 8 resources');

const ids = new Set();
const paths = new Set();
for (const resource of resources) {
  if (ids.has(resource.id)) failures.push('duplicate id ' + resource.id);
  ids.add(resource.id);
  if (paths.has(resource.path)) failures.push('duplicate path ' + resource.path);
  paths.add(resource.path);

  const terms = expected.get(resource.id);
  if (!terms) {
    failures.push('unexpected resource ' + resource.id);
    continue;
  }
  if (resource.price !== terms[0]) {
    failures.push(resource.id + ' price=' + resource.price + ' expected=' + terms[0]);
  }
  if (String(resource.amount) !== terms[1]) {
    failures.push(resource.id + ' amount=' + resource.amount + ' expected=' + terms[1]);
  }
  if (!String(resource.path).startsWith('/_api/')) {
    failures.push(resource.id + ' is not same-origin /_api route');
  }
  if (JSON.stringify(resource).includes('api-v2.appdeploy.ai')) {
    failures.push(resource.id + ' reintroduces AppDeploy runtime URL');
  }
  if (!printableAscii32(resource.serviceName)) {
    failures.push(resource.id + ' invalid x402 serviceName');
  }
  if (!Array.isArray(resource.tags) || resource.tags.length > 5) {
    failures.push(resource.id + ' invalid x402 tag count');
  } else {
    for (const tag of resource.tags) {
      if (!printableAscii32(tag)) failures.push(resource.id + ' invalid x402 tag ' + tag);
    }
  }
}

for (const id of expected.keys()) {
  if (!ids.has(id)) failures.push('missing resource ' + id);
}

const fixtures = Array.isArray(manifest.fixedFixtures) ? manifest.fixedFixtures : [];
if (fixtures.length !== 3) failures.push('expected exactly 3 fixed fixtures');
const fixtureCases = new Set(
  fixtures.map((fixture) => new URL('https://x.test' + fixture.path).searchParams.get('case'))
);
for (const name of ['proceed', 'address_mismatch', 'domain_mismatch']) {
  if (!fixtureCases.has(name)) failures.push('missing fixture ' + name);
}
for (const fixture of fixtures) {
  if (!String(fixture.path).startsWith('/_api/vendor-intake-demo?case=')) {
    failures.push('invalid fixture path ' + fixture.path);
  }
}

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('PASS target manifest: 8 unique same-origin paid routes');
  console.log('PASS exact prices/atomic amounts');
  console.log('PASS Base USDC/network/payout contract');
  console.log('PASS 3 bounded vendor-gate fixtures');
  console.log('PASS no AppDeploy runtime dependency');
  console.log('PASS x402 serviceName/tag metadata constraints');
}
