'use strict';

const fs=require('fs');
const path=require('path');
const opportunity=require('./opportunity-ledger');
const stripeSubscriber=require('./stripe-subscriber');
const subscriberArtifact=require('./subscriber-artifact');
const customerMessage=require('./customer-message');
const privateSheetMapping=require('./private-sheet-mapping');
const delivery=require('./delivery-plan');

const RUNNER_VERSION='PermitPlate-first-subscriber-canary-v1.0.0';

function packageReceipt(id,overrides){
  const base={
    packageVersion:'PermitPlate-candidate-package-v1.0.0',
    status:'READY_FOR_PROFILE_MATCHING',
    entityId:'CAMIS:'+id,
    graphDigest:'canary-graph',
    changeFingerprint:'canary-change-'+id,
    projectSignalId:'PS:canary:'+id,
    businessName:'Canary Venue '+id,
    address:id+' Canary Ave',
    borough:'Manhattan',
    zip:'10001',
    lifecycleStage:'JUST FILED',
    sourceFirstEffectiveAt:'2026-09-21T12:00:00Z',
    sourceLatestEffectiveAt:'2026-09-21T12:00:00Z',
    sourceSystems:['DOHMH'],
    sourceRecordIds:['DOHMH:'+id+':CANARY'],
    sourceUrls:['https://data.cityofnewyork.us/canary/'+id],
    commercialEvidence:[],
    detectionReceiptId:'DET:CANARY:'+id,
    detectionReceipt:{
      receiptId:'DET:CANARY:'+id,
      detectionClass:'NEW_ENTITY',
      customerEligible:true,
      entityId:'CAMIS:'+id,
      changeFingerprint:'canary-change-'+id,
      firstDetectedAt:'2026-09-21T17:00:00Z'
    },
    detectionClass:'NEW_ENTITY',
    detectedAt:'2026-09-21T17:00:00Z',
    scoringMode:'CANONICAL_V3_PRODUCTION',
    scoreReceiptId:'SCORE:CANARY:'+id,
    scoreReceipt:{
      scoreReceiptId:'SCORE:CANARY:'+id,
      productionAuthorized:true,
      scorerVersion:'permitplate-shadow-score-v3-2026-09-21',
      entityId:'CAMIS:'+id,
      graphDigest:'canary-graph',
      changeFingerprint:'canary-change-'+id,
      scores:{
        POS:72,Insurance:65,Equipment:82,'Hood/Fire':76,
        Waste:55,Pest:50,Linen:60,Distribution:66
      }
    },
    scorerVersion:'permitplate-shadow-score-v3-2026-09-21',
    commercialFit:'HIGH',
    scores:{
      POS:72,Insurance:65,Equipment:82,'Hood/Fire':76,
      Waste:55,Pest:50,Linen:60,Distribution:66
    },
    bestVendorFit:'Equipment',
    bestScore:82,
    productionAuthorized:true,
    failures:[]
  };
  const p=Object.assign(base,overrides||{});
  p.packageFingerprint=opportunity.sha256(opportunity.stableStringify({
    entityId:p.entityId,
    changeFingerprint:p.changeFingerprint,
    detectedAt:p.detectedAt,
    scores:p.scores,
    productionAuthorized:p.productionAuthorized
  }));
  p.packageId='PKG:'+p.packageFingerprint.slice(0,24);
  return p;
}

function buildCanaryOpportunityLedger(){
  const normal=packageReceipt('9001',{
    detectedAt:'2026-09-21T17:30:00Z',
    detectionReceipt:Object.assign({},packageReceipt('9001').detectionReceipt,{
      firstDetectedAt:'2026-09-21T17:30:00Z'
    })
  });
  const starter=packageReceipt('9002',{
    detectedAt:'2026-09-19T15:00:00Z',
    detectionReceipt:Object.assign({},packageReceipt('9002').detectionReceipt,{
      firstDetectedAt:'2026-09-19T15:00:00Z'
    }),
    scores:{
      POS:75,Insurance:65,Equipment:70,'Hood/Fire':62,
      Waste:50,Pest:48,Linen:52,Distribution:58
    },
    bestVendorFit:'POS',
    bestScore:75
  });
  const result=opportunity.appendOpportunityPackages(
    opportunity.emptyLedger('2026-09-18T00:00:00Z'),
    {passed:true,packages:[normal,starter]},
    '2026-09-21T18:00:00Z'
  );
  if(!result.committed) throw new Error('canary opportunity ledger build failed');
  return result.ledger;
}

function checkoutSession(){
  return {
    id:'cs_canary_permitplate',
    object:'checkout.session',
    payment_link:stripeSubscriber.PERMITPLATE_PAYMENT_LINK,
    mode:'subscription',
    status:'complete',
    payment_status:'paid',
    created:Date.parse('2026-09-21T15:55:00Z')/1000,
    customer:'cus_canary',
    customer_details:{email:'canary@permitplate.invalid'},
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    subscription:'sub_canary',
    custom_fields:[
      {key:'category',type:'dropdown',dropdown:{value:'equipment'}},
      {key:'territory',type:'text',text:{value:'Manhattan'}},
      {key:'starter',type:'dropdown',dropdown:{value:'yes'}}
    ]
  };
}
function subscription(){
  return {
    id:'sub_canary',
    object:'subscription',
    created:Date.parse('2026-09-21T16:00:00Z')/1000,
    status:'active',
    customer:'cus_canary',
    metadata:{project:'permitplate_nyc',plan:'monthly_79'},
    items:{data:[{price:{id:'price_1UFjcWDPW8riWrxQhnrPX6nc'}}]}
  };
}

function run(){
  const stripe=stripeSubscriber.profileFromCheckout({
    session:checkoutSession(),
    subscription:subscription(),
    expectedPriceId:'price_1UFjcWDPW8riWrxQhnrPX6nc'
  });
  if(stripe.status!=='ACTIVE') throw new Error('Stripe canary profile failed: '+stripe.failures.join(','));

  const ledger=buildCanaryOpportunityLedger();
  const first=subscriberArtifact.buildSubscriberArtifact({
    opportunityLedger:ledger,
    profile:{
      status:'ACTIVE',
      profile:stripe.profile,
      profileFingerprint:stripe.profileFingerprint
    },
    deliveredSignalKeys:[],
    reportDate:'2026-09-21'
  });
  if(first.status!=='READY') throw new Error('subscriber artifact canary failed');

  const message=customerMessage.renderCustomerMessage({
    artifact:first,
    reportDate:'2026-09-21'
  });
  if(message.status!=='READY') throw new Error('customer message canary failed');

  const attempt=delivery.createDeliveryAttempt({
    status:'READY',
    planFingerprint:first.artifactFingerprint,
    signals:first.signalKeys.map((signalKey)=>({signalKey}))
  },stripe.profile.recipientEmail);

  const profileSheetPlan=privateSheetMapping.subscriberProfileRow(stripe);
  const deliverySheetPlan=privateSheetMapping.deliveryStateRows({
    artifact:first,
    attempt,
    profile:{
      profile:stripe.profile,
      profileFingerprint:stripe.profileFingerprint
    }
  });

  const replay=subscriberArtifact.buildSubscriberArtifact({
    opportunityLedger:ledger,
    profile:{
      status:'ACTIVE',
      profile:stripe.profile,
      profileFingerprint:stripe.profileFingerprint
    },
    deliveredSignalKeys:first.signalKeys,
    reportDate:'2026-09-21'
  });

  const result={
    runnerVersion:RUNNER_VERSION,
    transportMode:'NO_SEND',
    externalSendCalls:0,
    checkoutSessionId:stripe.checkoutSessionId,
    subscriptionId:stripe.subscriptionId,
    baselineAt:stripe.profile.baselineAt,
    profileFingerprint:stripe.profileFingerprint,
    opportunityLedgerFingerprint:ledger.ledgerFingerprint,
    firstArtifact:{
      status:first.status,
      normalCount:first.normalCount,
      starterCount:first.starterCount,
      signalCount:first.signalCount,
      signalKeys:first.signalKeys,
      artifactFingerprint:first.artifactFingerprint,
      filename:first.filename,
      emailCsvParity:first.emailRows.map(r=>r.signalKey).join('|')===
        first.csvRows.map(r=>r['Signal Key']).join('|')
    },
    customerMessage:{
      status:message.status,
      subject:message.subject,
      signalKeys:message.signalKeys,
      messageFingerprint:message.messageFingerprint,
      attachmentSha256:message.attachment&&message.attachment.sha256||null
    },
    plannedAttempt:{
      attemptId:attempt.attemptId,
      messageIdentity:attempt.messageIdentity,
      state:attempt.state,
      signalKeys:attempt.signalKeys
    },
    privateStatePlan:{
      subscriberProfileSheet:profileSheetPlan.sheet,
      subscriberProfileColumnCount:profileSheetPlan.values.length,
      subscriberProfileRowFingerprint:profileSheetPlan.rowFingerprint,
      deliveryStateSheet:deliverySheetPlan.sheet,
      deliveryStateRowCount:deliverySheetPlan.rows.length,
      deliveryStateColumnCount:deliverySheetPlan.rows[0]?
        deliverySheetPlan.rows[0].values.length:0,
      deliveryStatus:deliverySheetPlan.deliveryStatus,
      providerStatus:deliverySheetPlan.providerStatus,
      deliveryStateBatchFingerprint:deliverySheetPlan.batchFingerprint
    },
    replayArtifact:{
      status:replay.status,
      signalCount:replay.signalCount,
      artifactFingerprint:replay.artifactFingerprint,
      alreadyDeliveredCount:replay.excluded.filter(x=>
        (x.reasons||[]).includes('ALREADY_DELIVERED')
      ).length
    }
  };
  result.passed=Boolean(
    result.baselineAt==='2026-09-21T16:00:00.000Z' &&
    result.firstArtifact.normalCount===1 &&
    result.firstArtifact.starterCount===1 &&
    result.firstArtifact.signalCount===2 &&
    result.firstArtifact.emailCsvParity===true &&
    result.customerMessage.status==='READY' &&
    result.customerMessage.signalKeys.join('|')===result.firstArtifact.signalKeys.join('|') &&
    Boolean(result.customerMessage.attachmentSha256) &&
    result.plannedAttempt.state==='PLANNED' &&
    result.privateStatePlan.subscriberProfileColumnCount===20 &&
    result.privateStatePlan.deliveryStateRowCount===2 &&
    result.privateStatePlan.deliveryStateColumnCount===15 &&
    result.privateStatePlan.deliveryStatus==='PLANNED' &&
    result.privateStatePlan.providerStatus==='NOT_SENT' &&
    result.replayArtifact.signalCount===0 &&
    result.replayArtifact.alreadyDeliveredCount===2 &&
    result.externalSendCalls===0
  );
  result.artifactFingerprint=opportunity.sha256(opportunity.stableStringify(result));
  return result;
}

if(require.main===module){
  const result=run();
  const outputPath=process.argv[2]?path.resolve(process.argv[2]):null;
  if(outputPath){
    fs.mkdirSync(path.dirname(outputPath),{recursive:true});
    fs.writeFileSync(outputPath,JSON.stringify(result,null,2)+'\n');
  }
  console.log(JSON.stringify(result,null,2));
  if(!result.passed) process.exitCode=1;
}

module.exports={
  RUNNER_VERSION,
  packageReceipt,
  buildCanaryOpportunityLedger,
  checkoutSession,
  subscription,
  run
};
