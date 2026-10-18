'use strict';

// Create a private, editable shortlist for the human founder. This does NOT
// assert vendor need, auto-approve a signal, or contact a buyer.
const fs=require('fs');
const path=require('path');
const stripe=require('./stripe-subscriber');
const research=require('./curated-research-ledger');
const curated=require('./curated-customer-brief');
const {privateMaterialPath,args}=require('./run-subscriber-intake');

const VERSION='PermitPlate-curated-review-queue-v1.0.0';

function makeQueue(input) {
  const data=input||{};
  const activated=stripe.profileFromCheckout({
    session:data.session,subscription:data.subscription,
    expectedPriceId:curated.EXPECTED_PRICE_ID
  });
  const graph=data.graph||{};
  const graphCheck=research.checkGraph(graph);
  const ledgerCheck=research.validate(data.ledger);
  const failures=[...graphCheck.failures,...ledgerCheck.failures];
  if (activated.status!=='ACTIVE') failures.push('SUBSCRIBER_NOT_ACTIVE');
  if (graph.graphDigest!==(data.ledger&&data.ledger.graphDigest) ||
      graph.observedAt!==(data.ledger&&data.ledger.observedAt)) {
    failures.push('GRAPH_LEDGER_MISMATCH');
  }
  const preparedAt=research.instant(data.preparedAt);
  const age=Date.parse(preparedAt)-Date.parse(graph.observedAt);
  if (!preparedAt || !Number.isFinite(age) || age<0 || age>curated.MAX_SOURCE_AGE_MS) {
    failures.push('SOURCE_SNAPSHOT_STALE');
  }
  const delivered=Array.isArray(data.deliveredSignalKeys)?
    new Set(data.deliveredSignalKeys.map(String)):null;
  if (!delivered) failures.push('DELIVERED_HISTORY_REQUIRED');
  if (failures.length) return {status:'REVIEW',failures:[...new Set(failures)]};

  const profile=activated.profile;
  const chosenCategory=stripe.customFieldValue(data.session,'category');
  const picks=[];
  for (const candidate of graph.candidates) {
    const entry=data.ledger.entries[candidate.entityId];
    if (!entry || entry.presenceState!=='PRESENT' ||
        !research.eligibleCandidate(candidate) ||
        !profile.boroughs.includes(candidate.borough)) continue;
    const event=curated.eventForEntry(
      entry,profile.baselineAt,profile.starterSnapshotEnabled,
      data.ledger.initializedAt
    );
    if(!event) continue;
    if(!research.instant(candidate.sourceLatestEffectiveAt)) continue;
    const key=curated.signalKey(activated.subscriptionId,entry,event);
    if (delivered.has(key)) continue;
    picks.push({
      entityId:candidate.entityId,
      category:chosenCategory,
      candidateFingerprint:curated.candidateIdentity(candidate),
      eventId:event.eventId,
      eventKind:event.kind,
      ownerReviewed:false,
      reviewedAt:null,
      whyItMatters:'',
      whatChanged:'',
      // Preview only; this content is not a reviewed customer claim.
      preview:{
        business:candidate.canonicalName,
        address:candidate.address,
        borough:candidate.borough,
        stage:candidate.lifecycleStage,
        section:event.section,
        eventKind:event.kind,
        firstObservedAt:event.observedAt,
        changeReasons:event.changeReasons,
        officialUrl:curated.primaryUrl(candidate)
      }
    });
  }
  picks.sort((a,b)=>b.preview.firstObservedAt.localeCompare(a.preview.firstObservedAt)||
    a.entityId.localeCompare(b.entityId));
  const limit=Math.min(100,Math.max(1,Number.isInteger(data.limit)?data.limit:50));
  return {
    status:'REVIEW_REQUIRED',
    runnerVersion:VERSION,
    reviewer:'',
    ownerReviewed:false,
    subscriptionId:activated.subscriptionId,
    graphDigest:graph.graphDigest,
    graphObservedAt:graph.observedAt,
    candidateCount:picks.length,
    shownCount:Math.min(limit,picks.length),
    notShownCount:Math.max(0,picks.length-limit),
    reviews:picks.slice(0,limit),
    instruction:'Select at most 10 records. Open and verify their official sources; evaluate category relevance and the event. For MATERIAL_CHANGE rows, summarize independently verified current and prior facts in whatChanged (the event reasons alone are not evidence of a specific change). Set per-row ownerReviewed=true and reviewedAt=current ISO timestamp only after review, and then top-level ownerReviewed=true. Delete unselected rows. Never send without separate explicit authorization.'
  };
}
function main() {
  const o=args(process.argv.slice(2));
  for (const key of ['checkout','graph','ledger','delivered','output']) {
    if (!o[key]) throw new Error('REQUIRED_ARGUMENT_MISSING:'+key);
  }
  const load=(file)=>JSON.parse(fs.readFileSync(privateMaterialPath(file),'utf8'));
  const checkout=load(o.checkout);
  const delivered=load(o.delivered);
  const history=Array.isArray(delivered)?delivered:delivered.deliveredSignalKeys;
  const result=makeQueue({
    session:checkout.session,subscription:checkout.subscription,
    graph:load(o.graph),ledger:load(o.ledger),
    deliveredSignalKeys:history,
    preparedAt:new Date().toISOString(),
    limit:o.limit?Number(o.limit):50
  });
  if (result.status==='REVIEW') {
    console.error(JSON.stringify({status:result.status,failures:result.failures}));
    process.exitCode=1;return;
  }
  const dest=privateMaterialPath(o.output);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  fs.writeFileSync(dest,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({
    status:result.status,candidateCount:result.candidateCount,
    shownCount:result.shownCount,output:dest,
    customerContacted:false
  },null,2));
}
if(require.main===module){
  try{main()}catch(error){console.error(error.message);process.exitCode=1}
}
module.exports={VERSION,makeQueue};
