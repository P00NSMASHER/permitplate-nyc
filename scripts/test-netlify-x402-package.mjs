import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (path) => readFile(new URL(path, root), 'utf8');

const target = JSON.parse(await read('recovery/x402-portfolio-target.json'));
const paths = [
  'recovery/netlify-x402/netlify/functions/_shared/catalog.mts',
  'recovery/netlify-x402/netlify/functions/paid.mts',
  'recovery/netlify-x402/netlify/functions/vendor-intake-demo.mts',
  'recovery/netlify-x402/netlify/functions/discovery.mts',
  'recovery/netlify-x402/netlify/functions/health.mts',
  'recovery/netlify-x402/public/index.html',
  'recovery/netlify-x402/netlify.toml',
];
const files = new Map();
for (const path of paths) files.set(path, await read(path));

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const allText = [...files.values()].join('\n');
expect(!allText.includes('api-v2.appdeploy.ai'), 'Netlify package reintroduces AppDeploy URL');
expect(
  allText.includes('https://agent-data-tools-x402.netlify.app'),
  'production Netlify origin missing'
);
expect(
  files.get('recovery/netlify-x402/netlify/functions/paid.mts').includes(
    "../../../x402-paid-operation.mjs"
  ),
  'paid router must import canonical paid-operation core'
);
expect(
  files.get('recovery/netlify-x402/netlify/functions/paid.mts').includes(
    "../../../x402-rehost-core.mjs"
  ),
  'paid router must import canonical data/decision core'
);

const catalog = files.get(
  'recovery/netlify-x402/netlify/functions/_shared/catalog.mts'
);
const paid = files.get('recovery/netlify-x402/netlify/functions/paid.mts');
const discovery = files.get(
  'recovery/netlify-x402/netlify/functions/discovery.mts'
);

const targetResources = Array.isArray(target.resources) ? target.resources : [];
expect(targetResources.length === 8, 'canonical target must have 8 resources');

for (const resource of targetResources) {
  expect(catalog.includes("id: '" + resource.id + "'"), 'catalog missing id ' + resource.id);
  expect(catalog.includes("path: '" + resource.path + "'"), 'catalog missing path ' + resource.path);
  expect(catalog.includes("price: '" + resource.price + "'"), 'catalog missing price ' + resource.id);
  expect(catalog.includes("amount: '" + resource.amount + "'"), 'catalog missing amount ' + resource.id);
  expect(paid.includes("'" + resource.path + "'"), 'paid function config missing path ' + resource.path);
}

for (const fixture of ['proceed', 'address_mismatch', 'domain_mismatch']) {
  expect(
    files
      .get('recovery/netlify-x402/netlify/functions/vendor-intake-demo.mts')
      .includes("'" + fixture + "'"),
    'missing Netlify fixed fixture ' + fixture
  );
}

expect(catalog.includes("type: 'http'"), 'resource records must declare type=http');
expect(catalog.includes('x402Version: 2'), 'resource records must declare x402Version=2');
expect(discovery.includes("openapi: ORIGIN + '/openapi.json'"), 'manifest openapi pointer missing');
expect(discovery.includes("llms: ORIGIN + '/llms.txt'"), 'manifest llms pointer missing');
expect(discovery.includes("skill: ORIGIN + '/skill.txt'"), 'manifest skill pointer missing');

for (const path of [
  '/.well-known/x402',
  '/openapi.json',
  '/llms.txt',
  '/llms-full.txt',
  '/skill.txt',
  '/robots.txt',
  '/sitemap.xml',
]) {
  expect(discovery.includes("'" + path + "'"), 'discovery route missing ' + path);
}

expect(
  files
    .get('recovery/netlify-x402/netlify/functions/health.mts')
    .includes('appDeployDependency: false'),
  'health route must declare no AppDeploy dependency'
);
expect(
  files.get('recovery/netlify-x402/netlify.toml').includes('node_bundler = "esbuild"'),
  'Netlify esbuild bundler not configured'
);

if (failures.length) {
  for (const failure of failures) console.error('FAIL ' + failure);
  process.exitCode = 1;
} else {
  console.log('PASS Netlify fallback contains all 8 target paid routes');
  console.log('PASS exact canonical prices/amounts are represented');
  console.log('PASS three bounded vendor-gate fixtures');
  console.log('PASS discovery paths');
  console.log('PASS canonical shared core imports');
  console.log('PASS no AppDeploy runtime dependency');
}
