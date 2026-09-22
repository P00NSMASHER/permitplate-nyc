const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REGISTER_PATH = path.join(__dirname, 'legacy-offer-retirement.json');

const register = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));

assert.equal(register.issue, 20);
assert.equal(register.decision, 'RETIRE');
assert.equal(register.supported, false);
assert.ok(
  ['PENDING_STRIPE_DEACTIVATION', 'RETIRED'].includes(register.status),
  'legacy pilot retirement status must be explicit'
);
assert.equal(register.retirement_acceptance.customer_contact_required, false);
assert.equal(register.retirement_acceptance.stripe_active_must_be_false, true);

if (register.status === 'RETIRED') {
  assert.equal(
    register.stripe.observed_active,
    false,
    'RETIRED requires verified Stripe active=false'
  );
}

const banned = [
  register.stripe.offer_metadata,
  register.stripe.payment_link_id,
  'https://buy.stripe.com/cNi00j2gP5Tp3Xp3yV9sk03'
];

const allowedFiles = new Set([
  path.normalize('operations/legacy-offer-retirement.json'),
  path.normalize('operations/legacy-offer-retirement.test.js')
]);

const textExtensions = new Set([
  '.html', '.js', '.json', '.md', '.txt', '.yml', '.yaml', '.toml', '.xml'
]);

function walk(dir) {
  const hits = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    const rel = path.normalize(path.relative(ROOT, full));

    if (entry.isDirectory()) {
      hits.push(...walk(full));
      continue;
    }

    if (allowedFiles.has(rel) || !textExtensions.has(path.extname(entry.name))) {
      continue;
    }

    const content = fs.readFileSync(full, 'utf8');
    for (const value of banned) {
      if (content.includes(value)) {
        hits.push(`${rel}: contains retired legacy offer reference ${JSON.stringify(value)}`);
      }
    }
  }
  return hits;
}

const hits = walk(ROOT);
assert.deepEqual(
  hits,
  [],
  `retired legacy pilot must not appear outside its retirement audit files:\n${hits.join('\n')}`
);

console.log('Legacy PermitPlate 5-lead pilot is denylisted from customer-facing/repository use.');
