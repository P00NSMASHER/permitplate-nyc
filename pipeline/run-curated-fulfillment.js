'use strict';

// Operator-only private fulfillment preparation: deliberately NO_SEND.
const fs = require('fs');
const path = require('path');
const curated = require('./curated-customer-brief');
const {privateMaterialPath,args} = require('./run-subscriber-intake');

const VERSION = 'PermitPlate-curated-fulfillment-runner-v1.0.0';

function readPrivate(file) {
  return JSON.parse(fs.readFileSync(privateMaterialPath(file),'utf8'));
}
function deliveredKeys(input) {
  if (Array.isArray(input)) return input;
  if (input && Array.isArray(input.deliveredSignalKeys)) return input.deliveredSignalKeys;
  throw new Error('EXPLICIT_PRIVATE_DELIVERY_HISTORY_REQUIRED');
}
function prepareFiles(paths, nowIso) {
  const checkout = readPrivate(paths.checkout);
  const reviewed = readPrivate(paths.reviews);
  return curated.prepare({
    session:checkout.session,
    subscription:checkout.subscription,
    graph:readPrivate(paths.graph),
    ledger:readPrivate(paths.ledger),
    reviews:reviewed.reviews,
    reviewer:reviewed.reviewer,
    ownerReviewed:reviewed.ownerReviewed,
    deliveredSignalKeys:deliveredKeys(readPrivate(paths.delivered)),
    preparedAt:nowIso || new Date().toISOString()
  });
}
function savePrivate(outputPath, result) {
  const dir = privateMaterialPath(outputPath);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    throw new Error('PRIVATE_OUTPUT_DIRECTORY_NOT_EMPTY');
  }
  fs.mkdirSync(dir,{recursive:true});
  const write = (name,content) => fs.writeFileSync(
    path.join(dir,name),content,{flag:'wx',mode:0o600}
  );
  const receipt = {
    runnerVersion:VERSION,
    status:result.status,
    failures:result.failures || [],
    subscriberId:result.subscriberId || null,
    sourceGraphDigest:result.sourceGraphDigest || null,
    ledgerFingerprint:result.ledgerFingerprint || null,
    profileFingerprint:result.profileFingerprint || null,
    baselineAt:result.baselineAt || null,
    signalCount:result.signalCount || 0,
    excluded:result.excluded || [],
    artifactFingerprint:result.brief && result.brief.artifactFingerprint || null,
    messageFingerprint:result.brief && result.brief.messageFingerprint || null,
    transportAllowed:false,
    externalSendCalls:0
  };
  write('curated-intake-receipt.json',JSON.stringify(receipt,null,2) + '\n');
  if (result.brief) {
    write(result.brief.filename,result.brief.csv);
    write('message.html',result.brief.html);
    write('message-subject.txt',result.brief.subject + '\n');
    write('owner-review.json',JSON.stringify({
      recipient:result.brief.recipientEmail,
      exactSignalKeys:result.brief.signalKeys,
      attempt:result.attempt,
      transportPreflight:result.transportPreflight,
      artifactFingerprint:result.brief.artifactFingerprint,
      messageFingerprint:result.brief.messageFingerprint,
      status:'OWNER_AUTHORIZATION_MISSING'
    },null,2) + '\n');
  }
  return dir;
}
function main() {
  const opts=args(process.argv.slice(2));
  for (const key of ['checkout','graph','ledger','reviews','delivered','output']) {
    if (!opts[key]) throw new Error('REQUIRED_ARGUMENT_MISSING:' + key);
  }
  const result=prepareFiles(opts,opts['prepared-at']);
  // A failed review leaves no customer artifact behind.
  if (result.status === 'REVIEW') {
    console.error(JSON.stringify({status:'REVIEW',failures:result.failures}));
    process.exitCode=1;
    return;
  }
  const output=savePrivate(opts.output,result);
  console.log(JSON.stringify({
    status:result.status,
    signalCount:result.signalCount,
    output,
    transportAllowed:false,
    ownerAuthorizationRequired:true
  },null,2));
}
if (require.main === module) {
  try{main()}catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={VERSION,readPrivate,deliveredKeys,prepareFiles,savePrivate,args};
