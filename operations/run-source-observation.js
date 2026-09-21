'use strict';

const fs = require('fs');
const path = require('path');
const {getSource} = require('./source-registry');
const {observeSocrataQuery} = require('./socrata-observer');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function upsertReceiptBundle(filePath, receipt, classification) {
  let bundle = {generatedAt: new Date().toISOString(), receipts: []};
  if (fs.existsSync(filePath)) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed && Array.isArray(parsed.receipts)) bundle = parsed;
  }

  const enriched = Object.assign({}, receipt, {
    declaredState: classification.state,
    absenceActionsAllowed: classification.supportsAbsenceConclusion
  });

  const key = `${receipt.sourceId}:${receipt.queryFingerprint}`;
  const remaining = bundle.receipts.filter((item) =>
    `${item.sourceId}:${item.queryFingerprint}` !== key
  );
  bundle.generatedAt = new Date().toISOString();
  bundle.receipts = remaining.concat([enriched])
    .sort((a, b) => `${a.sourceId}:${a.queryFingerprint}`.localeCompare(`${b.sourceId}:${b.queryFingerprint}`));

  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2) + '\n');
  return bundle;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source) {
    throw new Error('Usage: node operations/run-source-observation.js --source DOHMH|DOB|SLA --where "<SoQL>" [--select "<fields>"] [--order "<field>"] [--max-rows 10000] [--page-size 1000]');
  }
  if (!args.where && !args['allow-entire-source']) {
    throw new Error('Refusing an unscoped full-source pull. Provide --where or explicitly pass --allow-entire-source.');
  }

  const source = getSource(args.source);
  const scope = {
    where: args.where || null,
    select: args.select || null,
    order: args.order || null
  };
  const options = {
    pageSize: args['page-size'] ? Number(args['page-size']) : 1000,
    maxRows: args['max-rows'] ? Number(args['max-rows']) : 10000,
    appToken: process.env.SOCRATA_APP_TOKEN || null
  };

  const result = await observeSocrataQuery(source, scope, options);
  const bundlePath = path.resolve(args.output || path.join(__dirname, 'source-observation-receipts.json'));
  upsertReceiptBundle(bundlePath, result.receipt, result.classification);

  if (args['records-out']) {
    fs.writeFileSync(path.resolve(args['records-out']), JSON.stringify({
      source: source.key,
      queryFingerprint: result.receipt.queryFingerprint,
      observedAt: result.receipt.observedAt,
      records: result.records
    }, null, 2) + '\n');
  }

  const summary = {
    source: source.key,
    sourceId: result.receipt.sourceId,
    queryFingerprint: result.receipt.queryFingerprint,
    state: result.classification.state,
    reason: result.classification.reason,
    publisherCount: result.receipt.publisherCount,
    fetchedCount: result.receipt.fetchedCount,
    cursorClosed: result.receipt.cursorClosed,
    sourceFresh: result.receipt.sourceFresh,
    supportsPositiveObservation: result.classification.supportsPositiveObservation,
    supportsAbsenceConclusion: result.classification.supportsAbsenceConclusion,
    receiptBundle: bundlePath
  };
  console.log(JSON.stringify(summary, null, 2));

  if (args['require-complete'] && !result.classification.supportsAbsenceConclusion) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  upsertReceiptBundle
};
